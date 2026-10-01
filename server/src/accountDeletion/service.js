import { randomUUID } from 'node:crypto'
import pool from '../db.js'
import { verifyPassword } from '../auth/password.js'

export class AccountDeletionError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'AccountDeletionError'
    this.code = code
    this.status = status
  }
}

export async function requestAccountDeletion(input, dependencies = {}) {
  const database = dependencies.database ?? pool
  const verifyPasswordFn = dependencies.verifyPasswordFn ?? verifyPassword
  const objectPublicBaseUrl = dependencies.objectPublicBaseUrl ?? process.env.S3_PUBLIC_BASE_URL
  const userId = String(input?.userId ?? '').trim()
  const currentPassword = String(input?.currentPassword ?? '')
  if (!userId) throw new AccountDeletionError('invalid_user', 'User is required')
  if (input?.confirmation !== 'DELETE') {
    throw new AccountDeletionError('confirmation_required', 'Explicit deletion confirmation is required')
  }
  if (!currentPassword) throw new AccountDeletionError('password_required', 'Current password is required')

  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [users] = await connection.query(
      `SELECT id, password_hash
       FROM users
       WHERE id = ? AND status = 'ACTIVE'
       LIMIT 1
       FOR UPDATE`,
      [userId]
    )
    const user = users[0]
    if (!user) throw new AccountDeletionError('account_unavailable', 'Account is not available', 404)
    if (!(await verifyPasswordFn(currentPassword, user.password_hash))) {
      throw new AccountDeletionError('invalid_password', 'Current password is incorrect', 403)
    }

    const [listingRows] = await connection.query('SELECT id FROM listings WHERE author_id = ? FOR UPDATE', [userId])
    const listingIds = listingRows.map(row => row.id)
    const [uploadRows] = await connection.query(
      "SELECT object_key FROM uploads WHERE owner_id = ? AND status <> 'DELETED' FOR UPDATE",
      [userId]
    )
    const photoRows = listingIds.length
      ? (await connection.query(
          `SELECT url FROM photos WHERE listing_id IN (${sqlPlaceholders(listingIds)}) FOR UPDATE`,
          listingIds
        ))[0]
      : []
    const objectKeys = [...new Set([
      ...uploadRows.map(row => row.object_key),
      ...photoRows.map(row => objectKeyFromPublicUrl(row.url, objectPublicBaseUrl))
    ].filter(Boolean))]
    const ownerCheckIds = await selectRelatedIds(connection, 'owner_checks', userId, listingIds)
    const matchIds = await selectMatchIds(connection, listingIds)
    const chatIds = await selectChatIds(connection, userId, listingIds)

    const deletionId = randomUUID()
    const completed = objectKeys.length === 0
    await connection.query(
      `INSERT INTO account_deletion_jobs
         (id, user_id, status, object_count, completed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [deletionId, userId, completed ? 'COMPLETED' : 'PENDING', objectKeys.length, completed ? new Date() : null]
    )
    for (const objectKey of objectKeys) {
      await connection.query(
        `INSERT INTO account_deletion_objects
           (id, job_id, object_key, available_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [randomUUID(), deletionId, objectKey]
      )
    }

    await connection.query('DELETE FROM refresh_sessions WHERE user_id = ?', [userId])
    await connection.query('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId])
    await connection.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId])
    await connection.query("DELETE FROM outbox_events WHERE aggregate_type = 'USER' AND aggregate_id = ?", [userId])
    await connection.query('UPDATE user_consents SET withdrawn_at = COALESCE(withdrawn_at, CURRENT_TIMESTAMP) WHERE user_id = ?', [userId])
    await connection.query('DELETE FROM notifications WHERE user_id = ?', [userId])
    await connection.query('DELETE FROM match_feedback WHERE user_id = ?', [userId])
    await connection.query('DELETE FROM reports WHERE reporter_id = ?', [userId])
    await connection.query('UPDATE reports SET resolved_by = NULL WHERE resolved_by = ?', [userId])
    await connection.query('DELETE FROM chat_messages WHERE sender_id = ?', [userId])
    await connection.query('DELETE FROM chat_members WHERE user_id = ?', [userId])
    await connection.query('DELETE FROM states WHERE user_id = ?', [userId])
    await connection.query('DELETE FROM volunteer_assignments WHERE volunteer_id = ?', [userId])
    await connection.query(
      "UPDATE privacy_requests SET user_id = NULL, email = NULL, message = '[removed after account deletion]', resolution_note = NULL WHERE user_id = ?",
      [userId]
    )
    await connection.query('UPDATE privacy_requests SET resolved_by = NULL WHERE resolved_by = ?', [userId])

    await deletePayloadReferences(connection, 'matchId', matchIds)
    await deleteByIds(connection, 'match_feedback', 'match_id', matchIds)
    await deleteByIds(connection, 'matches', 'id', matchIds)

    await deletePayloadReferences(connection, 'ownerCheckId', ownerCheckIds)
    await deleteByIds(connection, 'owner_answers', 'owner_check_id', ownerCheckIds)
    await deleteByIds(connection, 'owner_check_contacts', 'owner_check_id', ownerCheckIds)
    await deleteByIds(connection, 'owner_checks', 'id', ownerCheckIds)

    await deleteByIds(connection, 'notifications', 'chat_id', chatIds)
    await deleteByIds(connection, 'chat_messages', 'chat_id', chatIds)
    await deleteByIds(connection, 'chat_members', 'chat_id', chatIds)
    await deleteByIds(connection, 'chats', 'id', chatIds)

    if (listingIds.length) {
      await deleteByIds(connection, 'notifications', 'listing_id', listingIds)
      await deleteByIds(connection, 'reports', 'listing_id', listingIds)
      await deleteByIds(connection, 'volunteer_assignments', 'listing_id', listingIds)
      await deleteByIds(connection, 'owner_questions', 'listing_id', listingIds)
      await deleteByIds(connection, 'listing_contact_preferences', 'listing_id', listingIds)
      await deleteByIds(connection, 'photos', 'listing_id', listingIds)
      await deleteByIds(connection, 'secrets', 'listing_id', listingIds)
      const placeholders = sqlPlaceholders(listingIds)
      await connection.query(
        `UPDATE listings
         SET status = 'DELETED', title = 'Удалённое объявление', description = NULL,
             lat = NULL, lng = NULL, district = NULL, occurred_at = NULL
         WHERE id IN (${placeholders})`,
        listingIds
      )
    }

    await connection.query('DELETE FROM uploads WHERE owner_id = ?', [userId])
    await connection.query(
      `UPDATE users
       SET status = 'DELETED', max_id = NULL, email = NULL, password_hash = NULL,
           display_name = NULL, phone = NULL, telegram = NULL, email_verified_at = NULL,
           auth_version = auth_version + 1
       WHERE id = ? AND status = 'ACTIVE'`,
      [userId]
    )
    await connection.query(
      `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, metadata)
       VALUES (?, ?, 'ACCOUNT_DELETED', 'USER', ?, ?)`,
      [randomUUID(), userId, userId, JSON.stringify({ deletionId, queuedObjects: objectKeys.length })]
    )
    await connection.commit()
    return { deletionId, status: completed ? 'COMPLETED' : 'PENDING', queuedObjects: objectKeys.length }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function selectRelatedIds(connection, table, userId, listingIds) {
  const listingClause = listingIds.length ? ` OR listing_id IN (${sqlPlaceholders(listingIds)})` : ''
  const [rows] = await connection.query(
    `SELECT id FROM ${table} WHERE holder_id = ? OR claimant_id = ?${listingClause} FOR UPDATE`,
    [userId, userId, ...listingIds]
  )
  return rows.map(row => row.id)
}

async function selectMatchIds(connection, listingIds) {
  if (!listingIds.length) return []
  const placeholders = sqlPlaceholders(listingIds)
  const [rows] = await connection.query(
    `SELECT id FROM matches WHERE lost_id IN (${placeholders}) OR found_id IN (${placeholders}) FOR UPDATE`,
    [...listingIds, ...listingIds]
  )
  return rows.map(row => row.id)
}

async function selectChatIds(connection, userId, listingIds) {
  const listingClause = listingIds.length
    ? ` OR lost_listing_id IN (${sqlPlaceholders(listingIds)}) OR found_listing_id IN (${sqlPlaceholders(listingIds)})`
    : ''
  const [rows] = await connection.query(
    `SELECT id FROM chats
     WHERE initiator_id = ? OR holder_id = ? OR claimant_id = ?${listingClause}
     FOR UPDATE`,
    [userId, userId, userId, ...listingIds, ...listingIds]
  )
  return rows.map(row => row.id)
}

async function deletePayloadReferences(connection, property, ids) {
  if (!ids.length) return
  await connection.query(
    `DELETE FROM notifications
     WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.${property}')) IN (${sqlPlaceholders(ids)})`,
    ids
  )
}

async function deleteByIds(connection, table, column, ids) {
  if (!ids.length) return
  await connection.query(`DELETE FROM ${table} WHERE ${column} IN (${sqlPlaceholders(ids)})`, ids)
}

function sqlPlaceholders(values) {
  return values.map(() => '?').join(',')
}

export function objectKeyFromPublicUrl(value, publicBaseUrl) {
  const base = String(publicBaseUrl ?? '').trim().replace(/\/$/, '')
  const url = String(value ?? '').trim()
  if (!base || !url.startsWith(`${base}/`)) return null
  try {
    return url.slice(base.length + 1).split('/').map(decodeURIComponent).join('/') || null
  } catch {
    return null
  }
}
