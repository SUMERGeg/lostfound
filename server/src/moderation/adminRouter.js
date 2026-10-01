import { Router } from 'express'
import { authenticateAccessToken, requireAdmin, requireVerifiedEmail } from '../auth/middleware.js'
import {
  listAdminListings,
  listAdminReports,
  listAdminUsers,
  moderateListing,
  ModerationError,
  moderateUser,
  updateReport
} from './service.js'
import {
  listPrivacyRequests,
  PrivacyRequestError,
  updatePrivacyRequest
} from '../privacyRequests/service.js'

const router = Router()
router.use(authenticateAccessToken, requireVerifiedEmail, requireAdmin)

router.get('/reports', endpoint(req => listAdminReports({ status: req.query.status })))
router.patch('/reports/:id', endpoint(async req => {
  const updated = await updateReport({
    reportId: req.params.id,
    adminId: req.auth.userId,
    status: req.body?.status,
    resolutionNote: req.body?.resolutionNote
  })
  if (!updated) throw new ModerationError('not_found', 'Report not found', 404)
  return { ok: true }
}))
router.get('/users', endpoint(() => listAdminUsers()))
router.patch('/users/:id', endpoint(async req => {
  const updated = await moderateUser({ userId: req.params.id, adminId: req.auth.userId, action: req.body?.action })
  if (!updated) throw new ModerationError('not_found', 'User cannot be moderated', 404)
  return { ok: true }
}))
router.get('/ads', endpoint(() => listAdminListings()))
router.patch('/ads/:id', endpoint(async req => {
  const updated = await moderateListing({ listingId: req.params.id, adminId: req.auth.userId, action: req.body?.action })
  if (!updated) throw new ModerationError('not_found', 'Advertisement cannot be moderated', 404)
  return { ok: true }
}))

router.get('/privacy-requests', endpoint(req => listPrivacyRequests({ status: req.query.status })))
router.patch('/privacy-requests/:id', endpoint(async req => {
  const updated = await updatePrivacyRequest({
    requestId: req.params.id,
    adminId: req.auth.userId,
    status: req.body?.status,
    resolutionNote: req.body?.resolutionNote
  })
  if (!updated) throw new PrivacyRequestError('not_found', 'Privacy request not found or already closed', 404)
  return { ok: true }
}))

function endpoint(action) {
  return async (req, res, next) => {
    try {
      res.json(await action(req))
    } catch (error) {
      if (error instanceof ModerationError || error instanceof PrivacyRequestError) {
        return res.status(error.status).json({ error: error.code, message: error.message })
      }
      next(error)
    }
  }
}

export default router
