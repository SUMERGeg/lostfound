import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pool } from './db.js'
import { migrations } from '../migrations/index.js'

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          VARCHAR(128) PRIMARY KEY,
  applied_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`

export async function runMigrations({ database = pool, logger = console } = {}) {
  const connection = await database.getConnection()

  try {
    await connection.query(MIGRATIONS_TABLE_SQL)
    const [rows] = await connection.query('SELECT id FROM schema_migrations')
    const applied = new Set(rows.map(row => row.id))
    const newlyApplied = []

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue

      logger.info?.(`[migrate] applying ${migration.id}`)
      await connection.beginTransaction()
      try {
        await migration.up(connection)
        await connection.query(
          'INSERT INTO schema_migrations (id) VALUES (?)',
          [migration.id]
        )
        await connection.commit()
        newlyApplied.push(migration.id)
      } catch (error) {
        await connection.rollback()
        throw new Error(`Migration ${migration.id} failed`, { cause: error })
      }
    }

    return newlyApplied
  } finally {
    connection.release()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runMigrations()
    .then(applied => {
      console.log(`[migrate] done; applied: ${applied.length}`)
      process.exit(0)
    })
    .catch(error => {
      console.error('[migrate] failed', error)
      process.exit(1)
    })
}
