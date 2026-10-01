import { randomUUID } from 'node:crypto'
import pool from '../db.js'
import { createObjectStorage } from '../uploads/storage.js'

export async function processNextAccountDeletionObject(dependencies = {}) {
  const database = dependencies.database ?? pool
  const logger = dependencies.logger ?? console
  const connection = await database.getConnection()
  const lockToken = randomUUID()
  let object

  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      `SELECT id, job_id, object_key, attempt_count
       FROM account_deletion_objects
       WHERE status = 'PENDING'
         AND available_at <= CURRENT_TIMESTAMP
         AND (locked_at IS NULL OR locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE))
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    )
    object = rows[0]
    if (!object) {
      await connection.commit()
      return false
    }
    await connection.query(
      'UPDATE account_deletion_objects SET locked_at = CURRENT_TIMESTAMP, lock_token = ? WHERE id = ?',
      [lockToken, object.id]
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  try {
    const storage = dependencies.storage ?? createObjectStorage()
    await storage.delete(object.object_key)
    await database.query(
      `UPDATE account_deletion_objects
       SET status = 'DELETED', deleted_at = CURRENT_TIMESTAMP,
           locked_at = NULL, lock_token = NULL, last_error = NULL
       WHERE id = ? AND lock_token = ?`,
      [object.id, lockToken]
    )
    const [pending] = await database.query(
      "SELECT 1 FROM account_deletion_objects WHERE job_id = ? AND status = 'PENDING' LIMIT 1",
      [object.job_id]
    )
    if (!pending.length) {
      await database.query(
        "UPDATE account_deletion_jobs SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING'",
        [object.job_id]
      )
    }
  } catch (error) {
    const attempt = Number(object.attempt_count ?? 0) + 1
    const delayMinutes = Math.min(60, 2 ** Math.min(attempt, 5))
    const message = String(error?.message ?? 'Object deletion failed').slice(0, 1000)
    await database.query(
      `UPDATE account_deletion_objects
       SET attempt_count = attempt_count + 1,
           available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE),
           locked_at = NULL, lock_token = NULL, last_error = ?
       WHERE id = ? AND lock_token = ?`,
      [delayMinutes, message, object.id, lockToken]
    )
    logger.error?.('[account-deletion] object cleanup failed', {
      deletionId: object.job_id,
      objectId: object.id,
      attempt
    })
  }
  return true
}

export function startAccountDeletionWorker({ schedule = setInterval, intervalMs = 30_000 } = {}) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      while (await processNextAccountDeletionObject()) {
        // Drain available objects serially; each object has its own durable retry state.
      }
    } catch (error) {
      console.error('[account-deletion] worker failed', { error: error.message })
    } finally {
      running = false
    }
  }
  const timer = schedule(run, intervalMs)
  timer.unref?.()
  return timer
}
