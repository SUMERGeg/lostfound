import pool from '../db.js'
import { createObjectStorage } from './storage.js'

export async function cleanupExpiredUploads(dependencies = {}) {
  const database = dependencies.database ?? pool
  const storage = dependencies.storage ?? createObjectStorage()
  const [rows] = await database.query(
    `SELECT id, object_key
     FROM uploads
     WHERE status = 'PENDING' AND expires_at <= CURRENT_TIMESTAMP
     ORDER BY expires_at ASC
     LIMIT 100`
  )

  let deleted = 0
  for (const upload of rows) {
    try {
      await storage.delete(upload.object_key)
      const [result] = await database.query(
        "UPDATE uploads SET status = 'DELETED' WHERE id = ? AND status = 'PENDING'",
        [upload.id]
      )
      if (result.affectedRows > 0) deleted += 1
    } catch (error) {
      console.error('[uploads] cleanup failed', { uploadId: upload.id, error: error.message })
    }
  }
  return { scanned: rows.length, deleted }
}

export function startUploadCleanup({ schedule = setInterval, intervalMs = 60 * 60 * 1000 } = {}) {
  const run = () => cleanupExpiredUploads().catch(error => {
    console.error('[uploads] cleanup job failed', { error: error.message })
  })
  const timer = schedule(run, intervalMs)
  timer.unref?.()
  return timer
}
