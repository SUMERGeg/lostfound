import assert from 'node:assert/strict'
import test from 'node:test'

import { clearRefreshCookie, readCookie, refreshCookie } from '../src/auth/cookies.js'
import { createAccessTokenAuthenticator } from '../src/auth/middleware.js'
import { hashPassword, verifyPassword } from '../src/auth/password.js'
import { AuthError, registerUser, rotateRefreshSession } from '../src/auth/service.js'
import { CURRENT_CONSENT_VERSIONS } from '../src/auth/consents.js'
import { LEGAL_DOCUMENTS } from '../../client/src/legal/documents.js'
import { createAccessToken, hashRefreshToken, verifyAccessToken } from '../src/auth/tokens.js'

const SECRET = 'test-only-access-secret-with-more-than-32-bytes'
const EMAIL_SECRET = 'different-test-email-secret-with-more-than-32-bytes'
const USER = { id: 'user-1', role: 'USER', status: 'ACTIVE' }

test('hashes passwords with a random salt and verifies them', async () => {
  const first = await hashPassword('correct horse battery staple')
  const second = await hashPassword('correct horse battery staple')

  assert.notEqual(first, second)
  assert.equal(first.includes('correct horse battery staple'), false)
  assert.equal(await verifyPassword('correct horse battery staple', first), true)
  assert.equal(await verifyPassword('wrong password', first), false)
})

test('signs, validates and expires access tokens', () => {
  const token = createAccessToken(USER, { secret: SECRET, now: 1_000_000, expiresIn: 60 })
  const claims = verifyAccessToken(token, { secret: SECRET, now: 1_030_000 })
  assert.equal(claims.sub, USER.id)
  assert.equal(claims.role, USER.role)

  assert.throws(
    () => verifyAccessToken(`${token.slice(0, -1)}x`, { secret: SECRET, now: 1_030_000 }),
    /Invalid access token/
  )
  assert.throws(
    () => verifyAccessToken(token, { secret: SECRET, now: 1_061_000 }),
    /Invalid access token/
  )
})

test('reads refresh cookies and applies production security attributes', () => {
  const header = refreshCookie('raw token', { production: true })
  assert.equal(readCookie(header), 'raw token')
  assert.match(header, /HttpOnly/)
  assert.match(header, /SameSite=Lax/)
  assert.match(header, /Secure/)
  assert.match(clearRefreshCookie({ production: true }), /Max-Age=0/)
})

test('frontend legal documents and backend consent requirements use identical versions', () => {
  assert.equal(LEGAL_DOCUMENTS.terms.version, CURRENT_CONSENT_VERSIONS.TERMS)
  assert.equal(LEGAL_DOCUMENTS.personalDataConsent.version, CURRENT_CONSENT_VERSIONS.PERSONAL_DATA)
})

test('access middleware derives identity from a valid bearer token', async () => {
  const previous = process.env.JWT_ACCESS_SECRET
  process.env.JWT_ACCESS_SECRET = SECRET
  try {
    const token = createAccessToken(USER, { secret: SECRET })
    const request = { get: name => name === 'authorization' ? `Bearer ${token}` : undefined }
    const response = responseDouble()
    let continued = false
    const authenticate = createAccessTokenAuthenticator({
      database: { async query() { return [[{ role: 'USER', status: 'ACTIVE', email_verified_at: new Date(), auth_version: 0 }]] } }
    })
    await authenticate(request, response, () => { continued = true })

    assert.equal(continued, true)
    assert.deepEqual(request.auth, { userId: USER.id, role: USER.role, emailVerified: true })
  } finally {
    if (previous === undefined) delete process.env.JWT_ACCESS_SECRET
    else process.env.JWT_ACCESS_SECRET = previous
  }
})

test('registers a user and stores neither raw password nor raw refresh token', async () => {
  const { database, calls } = authDatabaseDouble()
  const result = await registerUser(
    { email: ' Person@Example.com ', password: 'correct horse battery staple', displayName: 'Ирина', consents: validConsents() },
    { userAgent: 'test agent' },
    { database, accessTokenSecret: SECRET, emailTokenSecret: EMAIL_SECRET }
  )

  const userInsert = calls.find(call => String(call.sql).includes('INSERT INTO users'))
  const sessionInsert = calls.find(call => String(call.sql).includes('INSERT INTO refresh_sessions'))
  const consentInserts = calls.filter(call => String(call.sql).includes('INSERT INTO user_consents'))
  assert.equal(result.user.email, 'person@example.com')
  assert.equal(userInsert.params.includes('correct horse battery staple'), false)
  assert.equal(sessionInsert.params.includes(result.refreshToken), false)
  assert.equal(sessionInsert.params[2], hashRefreshToken(result.refreshToken))
  assert.equal(consentInserts.length, 2)
  assert.deepEqual(consentInserts.map(call => call.params.slice(2, 4)), [
    ['TERMS', CURRENT_CONSENT_VERSIONS.TERMS],
    ['PERSONAL_DATA', CURRENT_CONSENT_VERSIONS.PERSONAL_DATA]
  ])
  assert.equal(consentInserts[0].params[4], consentInserts[1].params[4])
  assert.equal(calls.some(call => call.action === 'commit'), true)
})

test('registration rejects missing terms consent before opening a transaction', async () => {
  const { database, calls } = authDatabaseDouble()
  await assert.rejects(
    registerUser(
      { email: 'person@example.com', password: 'correct horse battery staple', displayName: 'Ирина', consents: validConsents({ terms: false }) },
      {},
      { database, accessTokenSecret: SECRET, emailTokenSecret: EMAIL_SECRET }
    ),
    error => error instanceof AuthError && error.code === 'terms_consent_required'
  )
  assert.equal(calls.length, 0)
})

test('registration rejects missing personal data consent before opening a transaction', async () => {
  const { database, calls } = authDatabaseDouble()
  await assert.rejects(
    registerUser(
      { email: 'person@example.com', password: 'correct horse battery staple', displayName: 'Ирина', consents: validConsents({ personalData: false }) },
      {},
      { database, accessTokenSecret: SECRET, emailTokenSecret: EMAIL_SECRET }
    ),
    error => error instanceof AuthError && error.code === 'personal_data_consent_required'
  )
  assert.equal(calls.length, 0)
})

test('registration rejects an outdated consent document version', async () => {
  const { database, calls } = authDatabaseDouble()
  const consents = validConsents()
  consents[0].documentVersion = 'terms-old-version'
  await assert.rejects(
    registerUser(
      { email: 'person@example.com', password: 'correct horse battery staple', displayName: 'Ирина', consents },
      {},
      { database, accessTokenSecret: SECRET, emailTokenSecret: EMAIL_SECRET }
    ),
    error => error instanceof AuthError && error.code === 'consent_version_outdated'
  )
  assert.equal(calls.length, 0)
})

test('revokes the whole refresh family when an old token is reused', async () => {
  const session = {
    id: 'session-1',
    family_id: 'family-1',
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: new Date(),
    user_id: 'user-1',
    email: 'person@example.com',
    display_name: 'Person',
    role: 'USER',
    status: 'ACTIVE'
  }
  const { database, calls } = authDatabaseDouble({ refreshRows: [session] })

  await assert.rejects(
    rotateRefreshSession('a'.repeat(43), {}, { database, accessTokenSecret: SECRET }),
    error => error instanceof AuthError && error.code === 'invalid_refresh_token'
  )
  assert.equal(calls.some(call => String(call.sql).includes('WHERE family_id = ?')), true)
  assert.equal(calls.some(call => call.action === 'commit'), true)
})

function authDatabaseDouble({ refreshRows = [] } = {}) {
  const calls = []
  const connection = {
    async query(sql, params = []) {
      calls.push({ action: 'query', sql, params })
      if (String(sql).includes('SELECT id FROM users')) return [[]]
      if (String(sql).includes('FROM refresh_sessions rs')) return [refreshRows]
      return [{ affectedRows: 1 }]
    },
    async beginTransaction() { calls.push({ action: 'begin' }) },
    async commit() { calls.push({ action: 'commit' }) },
    async rollback() { calls.push({ action: 'rollback' }) },
    release() { calls.push({ action: 'release' }) }
  }
  return {
    calls,
    database: {
      async getConnection() { return connection },
      query: connection.query.bind(connection)
    }
  }
}

function validConsents({ terms = true, personalData = true } = {}) {
  return [
    { type: 'TERMS', accepted: terms, documentVersion: CURRENT_CONSENT_VERSIONS.TERMS },
    { type: 'PERSONAL_DATA', accepted: personalData, documentVersion: CURRENT_CONSENT_VERSIONS.PERSONAL_DATA }
  ]
}

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}
