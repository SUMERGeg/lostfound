import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const JWT_HEADER = Object.freeze({ alg: 'HS256', typ: 'JWT' })

export class AccessTokenError extends Error {}

export function createAccessToken(user, options = {}) {
  const secret = requireSigningSecret(options.secret)
  const now = Math.floor((options.now ?? Date.now()) / 1000)
  const expiresIn = options.expiresIn ?? ACCESS_TOKEN_TTL_SECONDS
  const payload = {
    sub: user.id,
    role: user.role,
    status: user.status,
    email_verified: Boolean(user.emailVerified),
    ver: Number(user.authVersion ?? 0),
    iat: now,
    exp: now + expiresIn,
    iss: options.issuer ?? 'lostfound-api',
    aud: options.audience ?? 'lostfound-web'
  }
  const encodedHeader = encodeJson(JWT_HEADER)
  const encodedPayload = encodeJson(payload)
  const unsigned = `${encodedHeader}.${encodedPayload}`
  return `${unsigned}.${sign(unsigned, secret)}`
}

export function verifyAccessToken(token, options = {}) {
  const secret = requireSigningSecret(options.secret)
  if (typeof token !== 'string') throw new AccessTokenError('Invalid access token')

  const parts = token.split('.')
  if (parts.length !== 3) throw new AccessTokenError('Invalid access token')
  const [encodedHeader, encodedPayload, signature] = parts
  const unsigned = `${encodedHeader}.${encodedPayload}`
  const expected = Buffer.from(sign(unsigned, secret), 'base64url')
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AccessTokenError('Invalid access token')
  }

  let header
  let payload
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'))
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    throw new AccessTokenError('Invalid access token')
  }

  const now = Math.floor((options.now ?? Date.now()) / 1000)
  if (
    header.alg !== 'HS256' ||
    header.typ !== 'JWT' ||
    !payload.sub ||
    payload.exp <= now ||
    payload.iat > now + 30 ||
    payload.iss !== (options.issuer ?? 'lostfound-api') ||
    payload.aud !== (options.audience ?? 'lostfound-web')
  ) {
    throw new AccessTokenError('Invalid access token')
  }

  return payload
}

export function createRefreshToken() {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token) {
  if (typeof token !== 'string' || token.length < 32) return null
  return createHash('sha256').update(token).digest('hex')
}

export function refreshExpiresAt(now = Date.now(), ttlSeconds = REFRESH_TOKEN_TTL_SECONDS) {
  return new Date(now + ttlSeconds * 1000)
}

export function getAccessTokenTtlSeconds() {
  return ACCESS_TOKEN_TTL_SECONDS
}

function requireSigningSecret(value) {
  const secret = value ?? process.env.JWT_ACCESS_SECRET
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new AccessTokenError('JWT_ACCESS_SECRET must contain at least 32 bytes')
  }
  return secret
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}
