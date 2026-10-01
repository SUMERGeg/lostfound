import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64
const SCRYPT_PARAMS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })

export class PasswordValidationError extends Error {}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new PasswordValidationError('Password must contain between 12 and 128 characters')
  }
  return password
}

export async function hashPassword(password) {
  const normalized = validatePassword(password)
  const salt = randomBytes(16)
  const derivedKey = await scrypt(normalized, salt, KEY_LENGTH, SCRYPT_PARAMS)
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`
}

export async function verifyPassword(password, storedHash) {
  if (
    typeof password !== 'string' ||
    password.length > 128 ||
    typeof storedHash !== 'string'
  ) return false

  const parts = storedHash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nValue, rValue, pValue, saltValue, hashValue] = parts
  const N = Number(nValue)
  const r = Number(rValue)
  const p = Number(pValue)
  if (N !== SCRYPT_PARAMS.N || r !== SCRYPT_PARAMS.r || p !== SCRYPT_PARAMS.p) return false

  try {
    const expected = Buffer.from(hashValue, 'base64url')
    if (expected.length !== KEY_LENGTH) return false
    const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), KEY_LENGTH, SCRYPT_PARAMS)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
