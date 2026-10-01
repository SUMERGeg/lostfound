import { Router } from 'express'
import { authenticateAccessToken } from '../auth/middleware.js'
import { createRateLimit } from '../rateLimit.js'
import { createPrivacyRequest, getPrivacyEmail, PrivacyRequestError } from './service.js'

const router = Router()
const configuredMax = Number(process.env.PRIVACY_REQUEST_RATE_LIMIT_MAX ?? 5)
const submissionLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number.isInteger(configuredMax) && configuredMax > 0 ? Math.min(configuredMax, 100) : 5,
  keyPrefix: 'privacy-request'
})

router.get('/config', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.json({ privacyEmail: getPrivacyEmail() })
})

router.post('/', optionalAuthentication, submissionLimit, async (req, res, next) => {
  try {
    const result = await createPrivacyRequest({
      userId: req.auth?.userId ?? null,
      email: req.body?.email,
      requestType: req.body?.requestType,
      message: req.body?.message
    })
    res.setHeader('Cache-Control', 'no-store')
    res.status(201).json(result)
  } catch (error) {
    if (error instanceof PrivacyRequestError) {
      return res.status(error.status).json({ error: error.code, message: error.message })
    }
    next(error)
  }
})

function optionalAuthentication(req, res, next) {
  if (!req.get('authorization')) return next()
  return authenticateAccessToken(req, res, next)
}

export default router

