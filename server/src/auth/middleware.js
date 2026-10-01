import { AccessTokenError, verifyAccessToken } from './tokens.js'
import pool from '../db.js'

export function createAccessTokenAuthenticator({ database = pool } = {}) {
  return async function authenticateAccessToken(req, res, next) {
    const authorization = req.get('authorization')
    const match = typeof authorization === 'string' && authorization.match(/^Bearer\s+(.+)$/i)
    if (!match) return unauthorized(res)

    try {
      const claims = verifyAccessToken(match[1])
      if (claims.status !== 'ACTIVE') return unauthorized(res)
      const [rows] = await database.query(
        'SELECT role, status, email_verified_at, auth_version FROM users WHERE id = ? LIMIT 1',
        [claims.sub]
      )
      const user = rows[0]
      if (!user || user.status !== 'ACTIVE' || Number(user.auth_version ?? 0) !== Number(claims.ver ?? 0)) {
        return unauthorized(res)
      }
      req.auth = { userId: claims.sub, role: user.role, emailVerified: Boolean(user.email_verified_at) }
      next()
    } catch (error) {
      if (error instanceof AccessTokenError) return unauthorized(res)
      next(error)
    }
  }
}

export const authenticateAccessToken = createAccessTokenAuthenticator()

export function requireVerifiedEmail(req, res, next) {
  if (!req.auth?.emailVerified) {
    return res.status(403).json({ error: 'email_verification_required' })
  }
  next()
}

export function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ error: 'admin_required' })
  next()
}

function unauthorized(res) {
  return res.status(401).json({ error: 'unauthorized' })
}
