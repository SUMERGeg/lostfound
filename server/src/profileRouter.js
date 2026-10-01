import { Router } from 'express'
import pool from './db.js'
import { authenticateAccessToken } from './auth/middleware.js'
import { clearRefreshCookie } from './auth/cookies.js'
import { AccountDeletionError, requestAccountDeletion } from './accountDeletion/service.js'
import { createRateLimit } from './rateLimit.js'

const router = Router()
const accountDeletionLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'account-deletion' })

router.use(authenticateAccessToken)

router.get('/', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, email, display_name AS displayName, phone, telegram, role, status,
            email_verified_at AS emailVerifiedAt, created_at AS createdAt
     FROM users
     WHERE id = ? AND status = 'ACTIVE'
     LIMIT 1`,
    [req.auth.userId]
  )
  if (!rows.length) return res.status(404).json({ error: 'not_found' })
  res.json(rows[0])
})

router.patch('/', async (req, res) => {
  const fields = []
  const values = []
  if (Object.hasOwn(req.body, 'displayName')) {
    const value = boundedText(req.body.displayName, 'displayName', 2, 120)
    fields.push('display_name = ?')
    values.push(value)
  }
  if (Object.hasOwn(req.body, 'phone')) {
    const value = optionalContact(req.body.phone, 'phone', 32)
    fields.push('phone = ?')
    values.push(value)
  }
  if (Object.hasOwn(req.body, 'telegram')) {
    const value = optionalContact(req.body.telegram, 'telegram', 64)
    fields.push('telegram = ?')
    values.push(value)
  }
  if (!fields.length) return res.status(400).json({ error: 'empty_update' })

  values.push(req.auth.userId)
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ? AND status = 'ACTIVE'`, values)
  res.json({ ok: true })
})

router.delete('/', accountDeletionLimit, async (req, res, next) => {
  try {
    const result = await requestAccountDeletion({
      userId: req.auth.userId,
      currentPassword: req.body?.currentPassword,
      confirmation: req.body?.confirmation
    })
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Set-Cookie', clearRefreshCookie())
    res.status(202).json(result)
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      return res.status(error.status).json({ error: error.code, message: error.message })
    }
    next(error)
  }
})

function boundedText(value, field, minimum, maximum) {
  const normalized = String(value ?? '').trim()
  if (normalized.length < minimum || normalized.length > maximum) {
    const error = new Error(`${field} has an invalid length`)
    error.status = 400
    throw error
  }
  return normalized
}

function optionalContact(value, field, maximum) {
  if (value === null || value === '') return null
  return boundedText(value, field, 3, maximum)
}

export default router
