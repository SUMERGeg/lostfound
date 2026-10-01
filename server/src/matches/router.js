import { Router } from 'express'
import { authenticateAccessToken, requireVerifiedEmail } from '../auth/middleware.js'
import { listMatches, MatchError, saveMatchFeedback } from './service.js'

const router = Router()
router.use(authenticateAccessToken, requireVerifiedEmail)

router.get('/', async (req, res) => {
  res.json(await listMatches(req.auth.userId, { limit: req.query.limit }))
})

router.put('/:id/feedback', async (req, res) => {
  try {
    const feedback = await saveMatchFeedback({
      matchId: req.params.id,
      userId: req.auth.userId,
      feedback: req.body.feedback
    })
    res.json({ feedback })
  } catch (error) {
    if (error instanceof MatchError) return res.status(error.status).json({ error: error.code, message: error.message })
    throw error
  }
})

export default router
