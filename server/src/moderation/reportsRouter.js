import { Router } from 'express'
import { authenticateAccessToken, requireVerifiedEmail } from '../auth/middleware.js'
import { createRateLimit } from '../rateLimit.js'
import { createReport, ModerationError } from './service.js'

const router = Router()
const reportLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'reports-create' })
router.use(authenticateAccessToken, requireVerifiedEmail)

router.post('/', reportLimit, async (req, res, next) => {
  try {
    const result = await createReport({
      reporterId: req.auth.userId,
      listingId: req.body?.listingId,
      reason: req.body?.reason,
      details: req.body?.details
    })
    res.status(201).json(result)
  } catch (error) {
    if (error instanceof ModerationError) return res.status(error.status).json({ error: error.code, message: error.message })
    next(error)
  }
})

export default router
