import crypto from 'node:crypto'

const SECRET_KEY = resolveSecretKey(process.env.SECRETS_KEY)
const SECRET_ALGO = 'aes-256-gcm'
const IV_LENGTH = 12

function resolveSecretKey(source) {
  if (!source) {
    console.warn('[security] SECRETS_KEY не задан — секреты будут храниться без шифрования.')
    return null
  }

  const trimmed = source.trim()

  try {
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      return Buffer.from(trimmed, 'hex')
    }

    if (trimmed.length === 32) {
      return Buffer.from(trimmed, 'utf8')
    }

    const base64 = Buffer.from(trimmed, 'base64')
    if (base64.length === 32) {
      return base64
    }
  } catch (error) {
    console.error('[security] Не удалось разобрать SECRETS_KEY:', error)
    return null
  }

  console.error('[security] Неверный формат SECRETS_KEY. Используйте 32-байтовый ключ (hex, base64 или ASCII).')
  return null
}

export function encryptSecrets(values = []) {
  return values
    .map(normalizeSecretEntry)
    .filter(Boolean)
    .map(entry => ({
      question: entry.question,
      cipher: encryptSecret(entry.answer)
    }))
}

export function encryptSecret(value) {
  if (!SECRET_KEY) {
    return {
      type: 'plain',
      value
    }
  }

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(SECRET_ALGO, SECRET_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    type: SECRET_ALGO,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  }
}

export function isEncryptionEnabled() {
  return Boolean(SECRET_KEY)
}

export function decryptSecret(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  if (!SECRET_KEY || payload.type === 'plain') {
    return payload.value ?? ''
  }

  if (payload.type !== SECRET_ALGO) {
    return ''
  }

  try {
    const iv = Buffer.from(payload.iv, 'base64')
    const tag = Buffer.from(payload.tag, 'base64')
    const encrypted = Buffer.from(payload.data, 'base64')
    const decipher = crypto.createDecipheriv(SECRET_ALGO, SECRET_KEY, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf8')
  } catch (error) {
    console.error('[security] Не удалось расшифровать секрет:', error)
    return ''
  }
}

function normalizeSecretEntry(entry) {
  if (!entry) {
    return null
  }

  if (typeof entry === 'string') {
    const answer = entry.trim()
    if (!answer) {
      return null
    }
    return { question: '', answer }
  }

  if (typeof entry !== 'object') {
    return null
  }

  const answer = typeof entry.answer === 'string' ? entry.answer.trim() : ''
  if (!answer) {
    return null
  }

  const question = typeof entry.question === 'string' ? entry.question.trim() : ''
  return { question, answer }
}



