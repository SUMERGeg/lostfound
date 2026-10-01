import { randomUUID } from 'node:crypto'
import pool from '../db.js'
import { enqueueOutbox } from '../outbox.js'
import { createActionToken, hashActionToken, validateActionToken, ActionTokenError } from './actionTokens.js'
import { hashPassword, PasswordValidationError } from './password.js'
import { AuthError } from './errors.js'

const VERIFY_PURPOSE = 'verify-email'
const RESET_PURPOSE = 'reset-password'

export async function createVerificationRequest(userId, dependencies = {}) {
  const database = dependencies.database ?? pool
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [users] = await connection.query(
      'SELECT id, email, display_name, email_verified_at FROM users WHERE id = ? AND status = \'ACTIVE\' LIMIT 1 FOR UPDATE',
      [userId]
    )
    const user = users[0]
    if (!user || !user.email) throw new AuthError('not_found', 'User not found', 404)
    if (user.email_verified_at) {
      await connection.commit()
      return { alreadyVerified: true }
    }
    await issueEmailToken(connection, 'email_verification_tokens', VERIFY_PURPOSE, user, 'AUTH_EMAIL_VERIFICATION', dependencies)
    await connection.commit()
    return { alreadyVerified: false }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function verifyEmail(rawToken, dependencies = {}) {
  const database = dependencies.database ?? pool
  const parsed = parseToken(rawToken, VERIFY_PURPOSE, dependencies.emailTokenSecret)
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      `SELECT user_id, expires_at, used_at
       FROM email_verification_tokens
       WHERE id = ? AND token_hash = ?
       LIMIT 1 FOR UPDATE`,
      [parsed.tokenId, parsed.tokenHash]
    )
    const token = rows[0]
    if (!usable(token)) throw invalidToken()
    await connection.query('UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [parsed.tokenId])
    await connection.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE id = ?', [token.user_id])
    await connection.commit()
    return { userId: token.user_id }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function requestPasswordReset(emailInput, dependencies = {}) {
  const database = dependencies.database ?? pool
  const email = normalizeEmailForLookup(emailInput)
  if (!email) return
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [users] = await connection.query(
      `SELECT id, email, display_name
       FROM users
       WHERE email = ? AND status = 'ACTIVE' AND password_hash IS NOT NULL
       LIMIT 1 FOR UPDATE`,
      [email]
    )
    if (users[0]) {
      await issueEmailToken(connection, 'password_reset_tokens', RESET_PURPOSE, users[0], 'AUTH_PASSWORD_RESET', dependencies)
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function resetPassword({ token: rawToken, password }, dependencies = {}) {
  let passwordHash
  try {
    passwordHash = await hashPassword(password)
  } catch (error) {
    if (error instanceof PasswordValidationError) throw new AuthError('invalid_password', error.message)
    throw error
  }
  const parsed = parseToken(rawToken, RESET_PURPOSE, dependencies.emailTokenSecret)
  const database = dependencies.database ?? pool
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      `SELECT user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE id = ? AND token_hash = ?
       LIMIT 1 FOR UPDATE`,
      [parsed.tokenId, parsed.tokenHash]
    )
    const token = rows[0]
    if (!usable(token)) throw invalidToken()
    await connection.query('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [parsed.tokenId])
    await connection.query(
      "UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ? AND status = 'ACTIVE'",
      [passwordHash, token.user_id]
    )
    await connection.query(
      'UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = ?',
      [token.user_id]
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function issueRegistrationVerification(connection, user, dependencies = {}) {
  return issueEmailToken(connection, 'email_verification_tokens', VERIFY_PURPOSE, user, 'AUTH_EMAIL_VERIFICATION', dependencies)
}

async function issueEmailToken(connection, table, purpose, user, eventType, dependencies) {
  const id = randomUUID()
  const rawToken = createActionToken(id, purpose, dependencies.emailTokenSecret)
  await connection.query(`UPDATE ${table} SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL`, [user.id])
  await connection.query(
    `INSERT INTO ${table} (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))`,
    [id, user.id, hashActionToken(rawToken), purpose === VERIFY_PURPOSE ? 1440 : 30]
  )
  await enqueueOutbox(connection, {
    eventType,
    aggregateType: 'USER',
    aggregateId: user.id,
    payload: { email: user.email, displayName: user.display_name ?? user.displayName, tokenId: id }
  })
}

function parseToken(rawToken, purpose, secret) {
  try {
    return validateActionToken(rawToken, purpose, secret)
  } catch (error) {
    if (error instanceof ActionTokenError) throw invalidToken()
    throw error
  }
}

function usable(token) {
  return token && !token.used_at && new Date(token.expires_at).getTime() > Date.now()
}

function invalidToken() {
  return new AuthError('invalid_or_expired_token', 'Token is invalid or expired', 400)
}

function normalizeEmailForLookup(value) {
  const email = String(value ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : null
}
