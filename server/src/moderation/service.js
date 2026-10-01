import { randomUUID } from 'node:crypto'
import pool from '../db.js'

const REPORT_REASONS = ['SPAM', 'FRAUD', 'INAPPROPRIATE', 'DUPLICATE', 'OTHER']
const REPORT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED']
const LISTING_ACTIONS = { HIDE: 'HIDDEN', RESTORE: 'ACTIVE', DELETE: 'DELETED' }

export class ModerationError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function createReport({ reporterId, listingId, reason, details }, { database = pool } = {}) {
  const normalizedReason = enumValue(reason, REPORT_REASONS, 'invalid_reason')
  const normalizedDetails = optionalText(details, 2000)
  try {
    const [result] = await database.query(
      `INSERT INTO reports (id, reporter_id, listing_id, reason, details)
       SELECT ?, ?, l.id, ?, ? FROM listings l
       WHERE l.id = ? AND l.status = 'ACTIVE' AND l.author_id <> ?`,
      [randomUUID(), reporterId, normalizedReason, normalizedDetails, listingId, reporterId]
    )
    if (result.affectedRows === 0) throw new ModerationError('not_found', 'Advertisement is not reportable', 404)
    return { ok: true }
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') throw new ModerationError('report_exists', 'You have already reported this advertisement', 409)
    throw error
  }
}

export async function listAdminReports({ status, database = pool } = {}) {
  const params = []
  let filter = ''
  if (status) {
    params.push(enumValue(status, REPORT_STATUSES, 'invalid_status'))
    filter = 'WHERE r.status = ?'
  }
  const [rows] = await database.query(
    `SELECT r.id, r.reason, r.details, r.status, r.resolution_note AS resolutionNote,
            r.created_at AS createdAt, r.updated_at AS updatedAt,
            l.id AS listingId, l.title AS listingTitle, l.status AS listingStatus,
            reporter.id AS reporterId, reporter.email AS reporterEmail,
            author.id AS authorId, author.email AS authorEmail
     FROM reports r
     JOIN listings l ON l.id = r.listing_id
     JOIN users reporter ON reporter.id = r.reporter_id
     JOIN users author ON author.id = l.author_id
     ${filter}
     ORDER BY FIELD(r.status, 'OPEN','IN_REVIEW','RESOLVED','REJECTED'), r.created_at ASC
     LIMIT 500`,
    params
  )
  return rows
}

export async function updateReport({ reportId, adminId, status, resolutionNote }, { database = pool } = {}) {
  const normalizedStatus = enumValue(status, REPORT_STATUSES, 'invalid_status')
  const allowedCurrentStatuses = normalizedStatus === 'IN_REVIEW'
    ? ['OPEN']
    : ['OPEN', 'IN_REVIEW']
  if (!['IN_REVIEW', 'RESOLVED', 'REJECTED'].includes(normalizedStatus)) {
    throw new ModerationError('invalid_transition', 'Report cannot transition to this status', 409)
  }
  const normalizedNote = optionalText(resolutionNote, 2000)
  const terminal = normalizedStatus === 'RESOLVED' || normalizedStatus === 'REJECTED'
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `UPDATE reports SET status = ?, resolution_note = ?,
         resolved_by = ?, resolved_at = ${terminal ? 'CURRENT_TIMESTAMP' : 'NULL'}
       WHERE id = ? AND status IN (${allowedCurrentStatuses.map(() => '?').join(',')})`,
      [normalizedStatus, normalizedNote, terminal ? adminId : null, reportId, ...allowedCurrentStatuses]
    )
    if (!result.affectedRows) {
      await connection.rollback()
      return false
    }
    await writeAudit(connection, adminId, 'REPORT_STATUS_CHANGED', 'REPORT', reportId, { status: normalizedStatus })
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function moderateListing({ listingId, adminId, action }, { database = pool } = {}) {
  const normalizedAction = String(action ?? '').toUpperCase()
  const nextStatus = LISTING_ACTIONS[normalizedAction]
  if (!nextStatus) throw new ModerationError('invalid_action', 'Unknown listing moderation action')
  const connection = await database.getConnection()
  const allowedCurrentStatuses = normalizedAction === 'HIDE' ? ['ACTIVE'] : normalizedAction === 'RESTORE' ? ['HIDDEN'] : ['ACTIVE', 'CLOSED', 'HIDDEN']
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `UPDATE listings SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN (${allowedCurrentStatuses.map(() => '?').join(',')})`,
      [nextStatus, listingId, ...allowedCurrentStatuses]
    )
    if (!result.affectedRows) {
      await connection.rollback()
      return false
    }
    await writeAudit(connection, adminId, `LISTING_${normalizedAction}`, 'LISTING', listingId, { status: nextStatus })
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function moderateUser({ userId, adminId, action }, { database = pool } = {}) {
  if (userId === adminId) throw new ModerationError('self_moderation', 'Administrators cannot moderate themselves', 409)
  const normalizedAction = String(action ?? '').toUpperCase()
  if (!['BLOCK', 'UNBLOCK'].includes(normalizedAction)) throw new ModerationError('invalid_action', 'Unknown user moderation action')
  const nextStatus = normalizedAction === 'BLOCK' ? 'BLOCKED' : 'ACTIVE'
  const previousStatus = normalizedAction === 'BLOCK' ? 'ACTIVE' : 'BLOCKED'
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      'UPDATE users SET status = ? WHERE id = ? AND status = ? AND role <> \'ADMIN\'',
      [nextStatus, userId, previousStatus]
    )
    if (!result.affectedRows) {
      await connection.rollback()
      return false
    }
    if (normalizedAction === 'BLOCK') {
      await connection.query('UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = ?', [userId])
      await connection.query("UPDATE listings SET status = 'HIDDEN' WHERE author_id = ? AND status = 'ACTIVE'", [userId])
    }
    await writeAudit(connection, adminId, `USER_${normalizedAction}`, 'USER', userId, { status: nextStatus })
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listAdminUsers({ database = pool } = {}) {
  const [rows] = await database.query(
    `SELECT id, email, display_name AS displayName, role, status, email_verified_at AS emailVerifiedAt, created_at AS createdAt
     FROM users ORDER BY created_at DESC LIMIT 500`
  )
  return rows
}

export async function listAdminListings({ database = pool } = {}) {
  const [rows] = await database.query(
    `SELECT l.id, l.title, l.type, l.category, l.status, l.created_at AS createdAt,
            u.id AS authorId, u.email AS authorEmail,
            (SELECT COUNT(*) FROM reports r WHERE r.listing_id = l.id AND r.status IN ('OPEN','IN_REVIEW')) AS openReports
     FROM listings l JOIN users u ON u.id = l.author_id
     ORDER BY l.created_at DESC LIMIT 500`
  )
  return rows
}

async function writeAudit(connection, actorId, action, targetType, targetId, metadata) {
  await connection.query(
    'INSERT INTO audit_log (id, actor_id, action, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    [randomUUID(), actorId, action, targetType, targetId, JSON.stringify(metadata ?? {})]
  )
}

function enumValue(value, allowed, code) {
  const normalized = String(value ?? '').toUpperCase()
  if (!allowed.includes(normalized)) throw new ModerationError(code, 'Unsupported value')
  return normalized
}

function optionalText(value, maximum) {
  const normalized = String(value ?? '').trim()
  if (normalized.length > maximum) throw new ModerationError('invalid_details', `Text must contain at most ${maximum} characters`)
  return normalized || null
}
