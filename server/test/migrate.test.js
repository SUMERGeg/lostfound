import assert from 'node:assert/strict'
import test from 'node:test'

import { runMigrations } from '../src/migrate.js'

function databaseDouble({ applied = [], failOn = null } = {}) {
  const calls = []
  const connection = {
    async query(sql, params = []) {
      calls.push(['query', sql, params])
      if (sql === 'SELECT id FROM schema_migrations') {
        return [applied.map(id => ({ id }))]
      }
      if (failOn && String(sql).includes(failOn)) {
        throw new Error('migration query failed')
      }
      if (String(sql).includes('information_schema')) {
        return [[]]
      }
      return [{ affectedRows: 1 }]
    },
    async beginTransaction() {
      calls.push(['begin'])
    },
    async commit() {
      calls.push(['commit'])
    },
    async rollback() {
      calls.push(['rollback'])
    },
    release() {
      calls.push(['release'])
    }
  }

  return {
    calls,
    database: {
      async getConnection() {
        calls.push(['getConnection'])
        return connection
      }
    }
  }
}

test('applies pending migrations in order and records them', async () => {
  const { database, calls } = databaseDouble()
  const applied = await runMigrations({ database, logger: {} })

  assert.deepEqual(applied, ['001_baseline', '002_web_auth', '003_uploads', '004_email_delivery', '005_owner_checks', '006_matching_v1', '007_moderation', '008_user_consents', '009_contact_disclosure', '010_account_deletion', '011_privacy_requests'])
  const recorded = calls
    .filter(call => call[0] === 'query' && call[1] === 'INSERT INTO schema_migrations (id) VALUES (?)')
    .map(call => call[2][0])
  assert.deepEqual(recorded, applied)
  assert.equal(calls.filter(call => call[0] === 'commit').length, 11)
  assert.equal(calls.at(-1)[0], 'release')
})

test('skips already applied migrations', async () => {
  const { database, calls } = databaseDouble({ applied: ['001_baseline', '002_web_auth', '003_uploads', '004_email_delivery', '005_owner_checks', '006_matching_v1', '007_moderation', '008_user_consents', '009_contact_disclosure', '010_account_deletion', '011_privacy_requests'] })
  const applied = await runMigrations({ database, logger: {} })

  assert.deepEqual(applied, [])
  assert.equal(calls.some(call => call[0] === 'begin'), false)
  assert.equal(calls.at(-1)[0], 'release')
})

test('rolls back and does not record a failed migration', async () => {
  const { database, calls } = databaseDouble({ failOn: 'CREATE TABLE IF NOT EXISTS users' })

  await assert.rejects(
    runMigrations({ database, logger: {} }),
    /Migration 001_baseline failed/
  )
  assert.equal(calls.some(call => call[0] === 'rollback'), true)
  assert.equal(
    calls.some(call => call[0] === 'query' && call[1] === 'INSERT INTO schema_migrations (id) VALUES (?)'),
    false
  )
  assert.equal(calls.at(-1)[0], 'release')
})
