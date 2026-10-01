import { Router } from 'express'
import { clearRefreshCookie, readCookie, refreshCookie } from './cookies.js'
import { AuthError, loginUser, logoutSession, registerUser, rotateRefreshSession } from './service.js'
import { createRateLimit } from '../rateLimit.js'
import { authenticateAccessToken } from './middleware.js'
import {
  createVerificationRequest,
  requestPasswordReset,
  resetPassword,
  verifyEmail
} from './emailService.js'

const router = Router()
const registerLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'auth-register' })
const loginLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'auth-login' })
const refreshLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 60, keyPrefix: 'auth-refresh' })
const emailActionLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'auth-email-action' })

router.post('/register', registerLimit, endpoint(async req => registerUser(req.body, requestContext(req)), 201))
router.post('/login', loginLimit, endpoint(async req => loginUser(req.body, requestContext(req))))
router.post('/refresh', refreshLimit, endpoint(async req => rotateRefreshSession(readCookie(req.get('cookie')), requestContext(req))))
router.post('/verify-email', emailActionLimit, actionEndpoint(async req => verifyEmail(req.body?.token)))
router.post('/verification-email', authenticateAccessToken, emailActionLimit, actionEndpoint(async req => createVerificationRequest(req.auth.userId)))
router.post('/forgot-password', emailActionLimit, async (req, res, next) => {
  try {
    await requestPasswordReset(req.body?.email)
    res.status(202).json({ ok: true })
  } catch (error) {
    next(error)
  }
})
router.post('/reset-password', emailActionLimit, actionEndpoint(async req => resetPassword(req.body)))
router.post('/logout', async (req, res, next) => {
  try {
    await logoutSession(readCookie(req.get('cookie')))
    res.setHeader('Set-Cookie', clearRefreshCookie())
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

function endpoint(handler, successStatus = 200) {
  return async (req, res, next) => {
    try {
      const result = await handler(req)
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Set-Cookie', refreshCookie(result.refreshToken))
      res.status(successStatus).json({
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user
      })
    } catch (error) {
      if (error instanceof AuthError) {
        return res.status(error.status).json({ error: error.code, message: error.message })
      }
      next(error)
    }
  }
}

function actionEndpoint(handler) {
  return async (req, res, next) => {
    try {
      const result = await handler(req)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ ok: true, ...result })
    } catch (error) {
      if (error instanceof AuthError) {
        return res.status(error.status).json({ error: error.code, message: error.message })
      }
      next(error)
    }
  }
}

function requestContext(req) {
  return { userAgent: req.get('user-agent') }
}

export default router
