import { createHash, randomUUID } from 'node:crypto'
import pool from '../db.js'
import { validateImage } from './imageValidation.js'
import { createObjectStorage } from './storage.js'

export async function storeImage({ ownerId, buffer, contentType }, dependencies = {}) {
  const database = dependencies.database ?? pool
  const storage = dependencies.storage ?? createObjectStorage()
  const detected = validateImage(buffer, contentType)
  const id = randomUUID()
  const objectKey = `uploads/${ownerId}/${id}.${detected.extension}`
  const publicUrl = await storage.put({ key: objectKey, body: buffer, contentType: detected.contentType })

  try {
    await database.query(
      `INSERT INTO uploads
        (id, owner_id, object_key, public_url, content_type, byte_size, sha256, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR))`,
      [id, ownerId, objectKey, publicUrl, detected.contentType, buffer.length, createHash('sha256').update(buffer).digest('hex')]
    )
  } catch (error) {
    try {
      await storage.delete(objectKey)
    } catch (cleanupError) {
      console.error('[uploads] failed to remove object after database error', {
        objectKey,
        error: cleanupError.message
      })
    }
    throw error
  }

  return { id, url: publicUrl, contentType: detected.contentType, byteSize: buffer.length }
}

export async function attachImages({ ownerId, listingId, uploadIds }, dependencies = {}) {
  const database = dependencies.database ?? pool
  const storage = dependencies.storage ?? createObjectStorage()
  const ids = Array.from(new Set(uploadIds ?? []))
  if (ids.length > 3 || ids.some(id => typeof id !== 'string' || !id.trim())) {
    throw new UploadValidationError('At most three valid upload IDs can be attached')
  }
  const connection = await database.getConnection()
  let replacedObjectKeys = []

  try {
    await connection.beginTransaction()
    const [listingRows] = await connection.query(
      'SELECT 1 FROM listings WHERE id = ? AND author_id = ? LIMIT 1 FOR UPDATE',
      [listingId, ownerId]
    )
    if (!listingRows.length) {
      await connection.rollback()
      return false
    }

    let uploads = []
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',')
      const [rows] = await connection.query(
        `SELECT id, public_url FROM uploads
         WHERE owner_id = ? AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP
           AND id IN (${placeholders})
         FOR UPDATE`,
        [ownerId, ...ids]
      )
      uploads = rows
      if (uploads.length !== ids.length) throw new UploadValidationError('One or more uploads are invalid')
    }

    const [replacedUploads] = await connection.query(
      "SELECT id, object_key FROM uploads WHERE listing_id = ? AND owner_id = ? AND status = 'ATTACHED' FOR UPDATE",
      [listingId, ownerId]
    )
    replacedObjectKeys = replacedUploads.map(upload => upload.object_key)
    if (replacedUploads.length) {
      await connection.query(
        "UPDATE uploads SET status = 'DELETED' WHERE listing_id = ? AND owner_id = ? AND status = 'ATTACHED'",
        [listingId, ownerId]
      )
    }
    await connection.query('DELETE FROM photos WHERE listing_id = ?', [listingId])
    for (const upload of uploads) {
      await connection.query('INSERT INTO photos (id, listing_id, url) VALUES (?, ?, ?)', [randomUUID(), listingId, upload.public_url])
      await connection.query("UPDATE uploads SET listing_id = ?, status = 'ATTACHED', expires_at = NULL WHERE id = ? AND owner_id = ?", [listingId, upload.id, ownerId])
    }
    await connection.commit()
    for (const objectKey of replacedObjectKeys) {
      try {
        await storage.delete(objectKey)
      } catch (error) {
        console.error('[uploads] failed to delete replaced object', { objectKey, error: error.message })
      }
    }
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export class UploadValidationError extends Error {}
