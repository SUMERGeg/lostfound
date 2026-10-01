import { randomUUID } from 'node:crypto'
import pool from '../db.js'
import { hashPassword, verifyPassword, PasswordValidationError } from './password.js'
import {
  createAccessToken,
  createRefreshToken,
  getAccessTokenTtlSeconds,
  hashRefreshToken,
  refreshExpiresAt
} from './tokens.js'
import { AuthError } from './errors.js'
import { issueRegistrationVerification } from './emailService.js'
import { validateRegistrationConsents } from './consents.js'

const DUMMY_PASSWORD_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$HfrUe6rycPIFqZxD1xFJMVljivEdVIZMerV_HA9C872vjdI7RLkcNW0_KQMjnXWGBrn700GxeayOUzv7lOsLPw'

export { AuthError } from './errors.js'

export async function registerUser(input, context = {}, dependencies = {}) {
  const database = dependencies.database ?? pool
  const email = normalizeEmail(input?.email)
  const displayName = normalizeDisplayName(input?.displayName)
  const consents = validateRegistrationConsents(input?.consents)
  let passwordHash
  try {
    passwordHash = await hashPassword(input?.password)
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      throw new AuthError('invalid_registration', error.message)
    }
    throw error
  }

  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [existing] = await connection.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
    if (existing.length) throw new AuthError('email_unavailable', 'Email is already registered', 409)

    const user = {
      id: randomUUID(),
      email,
      displayName,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: false,
      authVersion: 0
    }
    await connection.query(
      `INSERT INTO users (id, max_id, email, password_hash, display_name, status, role)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      [user.id, user.email, passwordHash, user.displayName, user.status, user.role]
    )
    const acceptedAt = new Date()
    for (const consent of consents) {
      await connection.query(
        `INSERT INTO user_consents
           (id, user_id, consent_type, document_version, accepted_at, source)
         VALUES (?, ?, ?, ?, ?, 'REGISTRATION')`,
        [randomUUID(), user.id, consent.type, consent.documentVersion, acceptedAt]
      )
    }
    await issueRegistrationVerification(connection, user, dependencies)
    const session = await insertRefreshSession(connection, user, context)
    const result = authResult(user, session.rawToken, dependencies)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') {
      throw new AuthError('email_unavailable', 'Email is already registered', 409)
    }
    throw error
  } finally {
    connection.release()
  }
}

export async function loginUser(input, context = {}, dependencies = {}) {
  const database = dependencies.database ?? pool
  const email = normalizeEmail(input?.email)
  const [rows] = await database.query(
    `SELECT id, email, password_hash, display_name, role, status, email_verified_at, auth_version
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  )
  const user = rows[0]
  const passwordMatches = await verifyPassword(
    input?.password,
    user?.password_hash ?? DUMMY_PASSWORD_HASH
  )
  if (!user || !passwordMatches || user.status !== 'ACTIVE') {
    throw new AuthError('invalid_credentials', 'Invalid email or password', 401)
  }

  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const session = await insertRefreshSession(connection, mapUser(user), context)
    const result = authResult(mapUser(user), session.rawToken, dependencies)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function rotateRefreshSession(rawToken, context = {}, dependencies = {}) {
  const database = dependencies.database ?? pool
  const tokenHash = hashRefreshToken(rawToken)
  if (!tokenHash) throw invalidRefreshToken()

  const connection = await database.getConnection()
  let committed = false
  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      `SELECT rs.id, rs.family_id, rs.expires_at, rs.revoked_at,
              u.id AS user_id, u.email, u.display_name, u.role, u.status, u.email_verified_at, u.auth_version
       FROM refresh_sessions rs
       JOIN users u ON u.id = rs.user_id
       WHERE rs.token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash]
    )
    const session = rows[0]
    if (!session) throw invalidRefreshToken()

    if (session.revoked_at) {
      await connection.query(
        'UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE family_id = ?',
        [session.family_id]
      )
      await connection.commit()
      committed = true
      throw invalidRefreshToken()
    }
    if (new Date(session.expires_at).getTime() <= Date.now() || session.status !== 'ACTIVE') {
      await connection.query('UPDATE refresh_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?', [session.id])
      await connection.commit()
      committed = true
      throw invalidRefreshToken()
    }

    const user = mapUser(session)
    const replacement = await insertRefreshSession(connection, user, context, session.family_id)
    await connection.query(
      'UPDATE refresh_sessions SET revoked_at = CURRENT_TIMESTAMP, replaced_by_id = ? WHERE id = ?',
      [replacement.id, session.id]
    )
    const result = authResult(user, replacement.rawToken, dependencies)
    await connection.commit()
    committed = true
    return result
  } catch (error) {
    if (!committed) await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function logoutSession(rawToken, dependencies = {}) {
  const tokenHash = hashRefreshToken(rawToken)
  if (!tokenHash) return
  const database = dependencies.database ?? pool
  await database.query(
    'UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE token_hash = ?',
    [tokenHash]
  )
}

async function insertRefreshSession(connection, user, context, familyId = randomUUID()) {
  const id = randomUUID()
  const rawToken = createRefreshToken()
  await connection.query(
    `INSERT INTO refresh_sessions
       (id, user_id, token_hash, family_id, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      user.id,
      hashRefreshToken(rawToken),
      familyId,
      refreshExpiresAt(),
      normalizeUserAgent(context.userAgent)
    ]
  )
  return { id, rawToken }
}

function authResult(user, refreshToken, dependencies) {
  return {
    accessToken: createAccessToken(user, { secret: dependencies.accessTokenSecret }),
    expiresIn: getAccessTokenTtlSeconds(),
    refreshToken,
    user
  }
}

function mapUser(row) {
  return {
    id: row.user_id ?? row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified_at),
    authVersion: Number(row.auth_version ?? 0)
  }
}

function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase()
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError('invalid_email', 'A valid email is required')
  }
  return email
}

function normalizeDisplayName(value) {
  const displayName = String(value ?? '').trim()
  if (displayName.length < 2 || displayName.length > 120) {
    throw new AuthError('invalid_display_name', 'Display name must contain between 2 and 120 characters')
  }
  return displayName
}

function normalizeUserAgent(value) {
  const userAgent = String(value ?? '').trim()
  return userAgent ? userAgent.slice(0, 512) : null
}

function invalidRefreshToken() {
  return new AuthError('invalid_refresh_token', 'Refresh session is invalid', 401)
}
