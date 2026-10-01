import { randomUUID } from 'node:crypto'
import pool from '../db.js'

const REQUEST_TYPES = ['ACCESS', 'CORRECTION', 'DELETION', 'WITHDRAW_CONSENT', 'OTHER']
const REQUEST_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']

export class PrivacyRequestError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'PrivacyRequestError'
    this.code = code
    this.status = status
  }
}

export async function createPrivacyRequest(input, dependencies = {}) {
  const database = dependencies.database ?? pool
  const idFactory = dependencies.idFactory ?? randomUUID
  const userId = input?.userId ? String(input.userId).trim() : null
  const requestType = enumValue(input?.requestType, REQUEST_TYPES, 'invalid_request_type')
  const message = boundedText(input?.message, 'message', 10, 3000)
  let email

  if (userId) {
    const [users] = await database.query(
      "SELECT email FROM users WHERE id = ? AND status = 'ACTIVE' LIMIT 1",
      [userId]
    )
    if (!users.length || !users[0].email) {
      throw new PrivacyRequestError('account_unavailable', 'Active account email is unavailable', 404)
    }
    email = users[0].email
  } else {
    email = normalizeEmail(input?.email)
  }

  const id = idFactory()
  await database.query(
    `INSERT INTO privacy_requests (id, user_id, email, request_type, message)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, email, requestType, message]
  )
  return { id, status: 'NEW' }
}

export async function listPrivacyRequests({ status, database = pool } = {}) {
  const params = []
  let filter = ''
  if (status) {
    params.push(enumValue(status, REQUEST_STATUSES, 'invalid_status'))
    filter = 'WHERE pr.status = ?'
  }
  const [rows] = await database.query(
    `SELECT pr.id, pr.user_id AS userId, pr.email, pr.request_type AS requestType,
            pr.message, pr.status, pr.resolution_note AS resolutionNote,
            pr.resolved_by AS resolvedBy, pr.resolved_at AS resolvedAt,
            pr.created_at AS createdAt, pr.updated_at AS updatedAt
     FROM privacy_requests pr
     ${filter}
     ORDER BY FIELD(pr.status, 'NEW','IN_PROGRESS','RESOLVED','REJECTED'), pr.created_at ASC
     LIMIT 500`,
    params
  )
  return rows
}

export async function updatePrivacyRequest({ requestId, adminId, status, resolutionNote }, dependencies = {}) {
  const database = dependencies.database ?? pool
  const idFactory = dependencies.idFactory ?? randomUUID
  const normalizedStatus = enumValue(status, REQUEST_STATUSES, 'invalid_status')
  if (!['IN_PROGRESS', 'RESOLVED', 'REJECTED'].includes(normalizedStatus)) {
    throw new PrivacyRequestError('invalid_transition', 'Privacy request cannot transition to this status', 409)
  }
  const allowedCurrent = normalizedStatus === 'IN_PROGRESS' ? ['NEW'] : ['NEW', 'IN_PROGRESS']
  const note = optionalText(resolutionNote, 2000)
  const terminal = normalizedStatus === 'RESOLVED' || normalizedStatus === 'REJECTED'
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `UPDATE privacy_requests
       SET status = ?, resolution_note = ?, resolved_by = ?,
           resolved_at = ${terminal ? 'CURRENT_TIMESTAMP' : 'NULL'}
       WHERE id = ? AND status IN (${allowedCurrent.map(() => '?').join(',')})`,
      [normalizedStatus, note, terminal ? adminId : null, requestId, ...allowedCurrent]
    )
    if (!result.affectedRows) {
      await connection.rollback()
      return false
    }
    await connection.query(
      `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, metadata)
       VALUES (?, ?, 'PRIVACY_REQUEST_STATUS_CHANGED', 'PRIVACY_REQUEST', ?, ?)`,
      [idFactory(), adminId, requestId, JSON.stringify({ status: normalizedStatus })]
    )
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export function getPrivacyEmail(environment = process.env) {
  return String(environment.PRIVACY_EMAIL ?? '').trim() || '[PRIVACY_EMAIL]'
}

function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase()
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PrivacyRequestError('invalid_email', 'A valid email is required')
  }
  return email
}

function enumValue(value, allowed, code) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!allowed.includes(normalized)) throw new PrivacyRequestError(code, 'Unsupported value')
  return normalized
}

function boundedText(value, field, minimum, maximum) {
  const normalized = String(value ?? '').trim()
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new PrivacyRequestError(`invalid_${field}`, `${field} must contain between ${minimum} and ${maximum} characters`)
  }
  return normalized
}

function optionalText(value, maximum) {
  const normalized = String(value ?? '').trim()
  if (normalized.length > maximum) throw new PrivacyRequestError('invalid_resolution_note', `Resolution note must contain at most ${maximum} characters`)
  return normalized || null
}

