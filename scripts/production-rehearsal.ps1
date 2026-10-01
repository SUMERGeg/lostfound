param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repositoryRoot 'docker-compose.rehearsal.yml'
$previousSmokeBase = $env:SMOKE_API_BASE

Push-Location $repositoryRoot
try {
  $upArguments = @('compose', '-f', $composeFile, 'up', '--detach', '--wait')
  if (-not $SkipBuild) { $upArguments += '--build' }
  & docker @upArguments
  if ($LASTEXITCODE -ne 0) { throw 'Production rehearsal containers failed to start.' }

  & docker compose -f $composeFile exec -T server npm run seed
  if ($LASTEXITCODE -ne 0) { throw 'Rehearsal seed failed.' }

  $env:SMOKE_API_BASE = 'http://127.0.0.1:18080'
  & node server/scripts/smoke-local.js
  if ($LASTEXITCODE -ne 0) { throw 'Production rehearsal smoke failed.' }

  $restoreDatabase = 'lostfound_restore_' + (Get-Date -Format 'yyyyMMddHHmmss')
  $countQuery = "SELECT CONCAT('migrations=', COUNT(*)) FROM schema_migrations; SELECT CONCAT('users=', COUNT(*)) FROM users; SELECT CONCAT('listings=', COUNT(*)) FROM listings; SELECT CONCAT('privacy_requests=', COUNT(*)) FROM privacy_requests; SELECT CONCAT('audit_log=', COUNT(*)) FROM audit_log;"
  $sourceCounts = (& docker compose -f $composeFile exec -T mysql mysql -urehearsal -prehearsal -N lostfound -e $countQuery) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read source counts for the restore drill.' }

  & docker compose -f $composeFile exec -T mysql mysql -uroot -prehearsal-root -e "CREATE DATABASE $restoreDatabase"
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated restore database.' }

  & docker compose -f $composeFile exec -T mysql sh -c "set -o pipefail; mysqldump -urehearsal -prehearsal --single-transaction --no-tablespaces lostfound | mysql -uroot -prehearsal-root $restoreDatabase"
  if ($LASTEXITCODE -ne 0) { throw 'Backup restore drill failed.' }

  $restoredCounts = (& docker compose -f $composeFile exec -T mysql mysql -uroot -prehearsal-root -N $restoreDatabase -e $countQuery) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $restoredCounts -ne $sourceCounts) {
    throw "Restored database counts differ from the source.`nSource:`n$sourceCounts`nRestored:`n$restoredCounts"
  }
  & docker compose -f $composeFile exec -T mysql mysql -uroot -prehearsal-root -e "DROP DATABASE $restoreDatabase"
  if ($LASTEXITCODE -ne 0) { throw 'Restore verification passed, but the temporary restore database could not be removed.' }

  Write-Host 'Production rehearsal and isolated backup/restore drill passed.'
  Write-Host 'The stack remains available at http://127.0.0.1:18080.'
  Write-Host 'Stop it with: docker compose -f docker-compose.rehearsal.yml down'
} finally {
  if ($null -eq $previousSmokeBase) {
    Remove-Item Env:SMOKE_API_BASE -ErrorAction SilentlyContinue
  } else {
    $env:SMOKE_API_BASE = $previousSmokeBase
  }
  Pop-Location
}
