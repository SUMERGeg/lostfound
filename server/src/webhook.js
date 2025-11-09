import { Router } from 'express'
import { handleUpdate } from './max.js'

const router = Router()

router.post('/', async (req, res) => {
  try {
    await handleUpdate(req.body)
    res.json({ ok: true })
  } catch (error) {
    console.error('Webhook processing error', error)
    // Возвращаем 200, чтобы MAX не слал повторно, но логируем проблему
    res.json({ ok: true, error: 'PROCESSING_FAILED' })
  }
})

router.get('/', (_, res) => {
  res.json({ ok: true })
})

export default router

