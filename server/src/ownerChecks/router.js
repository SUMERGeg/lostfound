import { Router } from 'express'
import { authenticateAccessToken, requireVerifiedEmail } from '../auth/middleware.js'
import { createRateLimit } from '../rateLimit.js'
import {
  decideOwnerCheck,
  getOwnerCheck,
  getOwnerCheckContacts,
  getPublicQuestions,
  listOwnerChecks,
  OwnerCheckError,
  replaceOwnerQuestions,
  submitOwnerCheck
} from './service.js'

const router = Router()
const claimLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'owner-check-claim' })

router.use(authenticateAccessToken, requireVerifiedEmail)

router.get('/', handler(async req => listOwnerChecks(req.auth.userId)))
router.get('/questions/:listingId', handler(async req => getPublicQuestions({
  listingId: req.params.listingId,
  claimantId: req.auth.userId
})))
router.put('/questions/:listingId', handler(async req => {
  const updated = await replaceOwnerQuestions({
    listingId: req.params.listingId,
    holderId: req.auth.userId,
    prompts: req.body?.prompts
  })
  if (!updated) throw new OwnerCheckError('not_found', 'Advertisement not found', 404)
  return { ok: true }
}))
router.post('/', claimLimit, handler(async req => ({
  id: await submitOwnerCheck({
    listingId: req.body?.listingId,
    claimantId: req.auth.userId,
    answers: req.body?.answers
  })
}), 201))
router.get('/:id', handler(async req => getOwnerCheck(req.params.id, req.auth.userId)))
router.patch('/:id/decision', handler(async req => {
  const updated = await decideOwnerCheck({
    checkId: req.params.id,
    holderId: req.auth.userId,
    decision: req.body?.decision
  })
  if (!updated) throw new OwnerCheckError('not_found', 'Pending owner check not found', 404)
  return { ok: true }
}))
router.get('/:id/contacts', handler(async req => getOwnerCheckContacts({
  checkId: req.params.id,
  userId: req.auth.userId
})))

function handler(action, successStatus = 200) {
  return async (req, res, next) => {
    try {
      res.status(successStatus).json(await action(req))
    } catch (error) {
      if (error instanceof OwnerCheckError) {
        return res.status(error.status).json({ error: error.code, message: error.message })
      }
      next(error)
    }
  }
}

export default router
