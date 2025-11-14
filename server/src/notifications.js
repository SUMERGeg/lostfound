import crypto from 'node:crypto'
import pool from './db.js'

export const NotificationStatus = {
  UNREAD: 'UNREAD',
  ACTION: 'ACTION',
  READ: 'READ',
  RESOLVED: 'RESOLVED',
  ARCHIVED: 'ARCHIVED'
}

export const NotificationType = {
  OWNER_WAITING: 'OWNER_WAITING',
  OWNER_REVIEW: 'OWNER_REVIEW',
  OWNER_APPROVED: 'OWNER_APPROVED',
  OWNER_DECLINED: 'OWNER_DECLINED',
  CONTACT_SHARE_REQUEST: 'CONTACT_SHARE_REQUEST',
  CONTACT_AVAILABLE: 'CONTACT_AVAILABLE',
  LISTING_PUBLISHED: 'LISTING_PUBLISHED',
  MATCH_FOUND: 'MATCH_FOUND',
  VOLUNTEER_ASSIGNED: 'VOLUNTEER_ASSIGNED',
  VOLUNTEER_ACTIVE: 'VOLUNTEER_ACTIVE'
}

export async function createNotification({
  userId,
  type,
  title,
  body,
  status = NotificationStatus.UNREAD,
  payload = {},
  chatId = null,
  listingId = null
}) {
  if (!userId || !type) {
    throw new Error('userId and type are required to create notification')
  }

  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO notifications (id, user_id, chat_id, listing_id, type, title, body, payload, status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, userId, chatId, listingId, type, title ?? null, body ?? null, JSON.stringify(payload ?? {}), status]
  )

  return id
}

export async function upsertNotification(criteria, data) {
  const { userId, type, chatId = null } = criteria ?? {}
  if (!userId || !type) {
    throw new Error('userId and type are required for upsertNotification')
  }

  const [rows] = await pool.query(
    `SELECT id FROM notifications
     WHERE user_id = ? AND type = ? AND ${chatId ? 'chat_id = ?' : 'chat_id IS NULL'}
     ORDER BY created_at DESC
     LIMIT 1`,
    chatId ? [userId, type, chatId] : [userId, type]
  )

  if (rows.length === 0) {
    return createNotification({
      userId,
      type,
      chatId,
      ...data
    })
  }

  const id = rows[0].id
  await updateNotification(id, data)
  return id
}

export async function updateNotification(id, patch = {}) {
  if (!id) return

  const fields = []
  const values = []

  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    fields.push('title = ?')
    values.push(patch.title ?? null)
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'body')) {
    fields.push('body = ?')
    values.push(patch.body ?? null)
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    fields.push('status = ?')
    values.push(patch.status ?? NotificationStatus.UNREAD)
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'payload')) {
    fields.push('payload = ?')
    values.push(JSON.stringify(patch.payload ?? {}))
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'listingId')) {
    fields.push('listing_id = ?')
    values.push(patch.listingId ?? null)
  }

  if (fields.length === 0) {
    return
  }

  fields.push('updated_at = CURRENT_TIMESTAMP')

  await pool.query(
    `UPDATE notifications SET ${fields.join(', ')} WHERE id = ?`,
    [...values, id]
  )
}

export async function markNotificationRead(id) {
  if (!id) return
  await pool.query(
    `UPDATE notifications
     SET status = CASE WHEN status = 'ARCHIVED' THEN status ELSE 'READ' END,
         read_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [id]
  )
}

export async function archiveNotification(id) {
  if (!id) return
  await pool.query(
    `UPDATE notifications
     SET status = 'ARCHIVED',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [id]
  )
}

export async function listNotifications(userId, { limit = 10, includeArchived = false } = {}) {
  if (!userId) {
    return []
  }

  const sql = `
    SELECT *
    FROM notifications
    WHERE user_id = ?
      ${includeArchived ? '' : "AND status <> 'ARCHIVED'"}
    ORDER BY
      FIELD(status, 'ACTION', 'UNREAD', 'READ', 'RESOLVED', 'ARCHIVED'),
      created_at DESC
    LIMIT ?
  `

  const [rows] = await pool.query(sql, [userId, limit])
  return rows.map(mapNotificationRow)
}

function mapNotificationRow(row) {
  let payload = {}
  try {
    payload = row?.payload ? JSON.parse(row.payload) : {}
  } catch (error) {
    payload = {}
  }

  return {
    id: row.id,
    userId: row.user_id,
    chatId: row.chat_id,
    listingId: row.listing_id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at
  }
}


