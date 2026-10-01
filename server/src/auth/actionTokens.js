import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export class ActionTokenError extends Error {}

export function createActionToken(tokenId, purpose, secret = process.env.EMAIL_TOKEN_SECRET) {
  const key = requireSecret(secret)
  const signature = createHmac('sha256', key).update(`${purpose}:${tokenId}`).digest('base64url')
  return `${tokenId}.${signature}`
}

export function validateActionToken(rawToken, purpose, secret = process.env.EMAIL_TOKEN_SECRET) {
  if (typeof rawToken !== 'string') throw new ActionTokenError('Invalid token')
  const separator = rawToken.indexOf('.')
  if (separator < 1) throw new ActionTokenError('Invalid token')
  const tokenId = rawToken.slice(0, separator)
  const expected = createActionToken(tokenId, purpose, secret)
  const actualBuffer = Buffer.from(rawToken)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new ActionTokenError('Invalid token')
  }
  return { tokenId, tokenHash: hashActionToken(rawToken) }
}

export function hashActionToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex')
}

function requireSecret(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32) {
    throw new ActionTokenError('EMAIL_TOKEN_SECRET must contain at least 32 bytes')
  }
  return value
}
