import { Router } from 'express'
import { authenticateAccessToken, requireVerifiedEmail } from './auth/middleware.js'
import { listNotifications, markNotificationRead } from './notifications.js'

const router = Router()
router.use(authenticateAccessToken, requireVerifiedEmail)

router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
  res.json(await listNotifications(req.auth.userId, { limit }))
})

router.patch('/:id/read', async (req, res) => {
  const updated = await markNotificationRead(req.params.id, req.auth.userId)
  if (!updated) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

export default router
