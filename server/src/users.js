import crypto from 'node:crypto'
import pool from './db.js'

/**
 * Находит пользователя по MAX user id или создаёт новую запись.
 * Возвращает внутренний идентификатор (UUID) и исходный MAX ID.
 */
export async function ensureUser(maxUserId, { phone } = {}) {
  if (!maxUserId) {
    throw new Error('MAX user id is required')
  }

  const maxId = String(maxUserId)

  const [rows] = await pool.query(
    'SELECT id, phone FROM users WHERE max_id = ? LIMIT 1',
    [maxId]
  )

  if (rows.length > 0) {
    const existing = rows[0]

    if (phone && phone !== existing.phone) {
      await pool.query(
        'UPDATE users SET phone = ? WHERE id = ?',
        [phone, existing.id]
      )
    }

    return { userId: existing.id, maxUserId: maxId }
  }

  const userId = crypto.randomUUID()

  await pool.query(
    'INSERT INTO users (id, max_id, phone) VALUES (?, ?, ?)',
    [userId, maxId, phone ?? null]
  )

  return { userId, maxUserId: maxId }
}

export async function upsertUserContact(maxUserId, phone) {
  if (!maxUserId || !phone) {
    return
  }

  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    return
  }

  const { userId } = await ensureUser(maxUserId)
  await pool.query('UPDATE users SET phone = ? WHERE id = ?', [normalizedPhone, userId])
}

function normalizePhone(value) {
  if (!value) {
    return null
  }
  const digits = String(value).replace(/\D+/g, '')
  if (digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`
  }
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7${digits.slice(1)}`
  }
  if (digits.length === 10) {
    return `+7${digits}`
  }
  if (digits.startsWith('+') && digits.length >= 11) {
    return digits
  }
  return null
}


