import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import listingsRouter from './listings.js'
import { startMatchingScheduler } from './cron.js'
import authRouter from './auth/router.js'
import { loadRuntimeConfig } from './config.js'
import profileRouter from './profileRouter.js'
import uploadsRouter from './uploads/router.js'
import { startUploadCleanup } from './uploads/cleanup.js'
import { startOutboxWorker } from './email/outboxWorker.js'
import { startAccountDeletionWorker } from './accountDeletion/worker.js'
import privacyRequestsRouter from './privacyRequests/router.js'
import ownerChecksRouter from './ownerChecks/router.js'
import notificationsRouter from './notificationsRouter.js'
import matchesRouter from './matches/router.js'
import reportsRouter from './moderation/reportsRouter.js'
import adminRouter from './moderation/adminRouter.js'
import { pool } from './db.js'
import { requestContext, securityHeaders, writeErrorLog } from './operational.js'
import { createRateLimit } from './rateLimit.js'

dotenv.config()

const app = express()
const { port, frontOrigin, allowedOrigins } = loadRuntimeConfig()
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)

app.use(requestContext)
app.use(securityHeaders)
app.use(createRateLimit({ windowMs: 15 * 60 * 1000, max: 300, keyPrefix: 'global' }))

// CORS для фронтенда
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  })
)

app.use(express.json({ limit: '1mb' }))

app.get('/health', (req, res) => res.json({ ok: true }))
app.get('/health/live', (req, res) => res.json({ ok: true }))
app.get('/health/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true })
  } catch {
    res.status(503).json({ ok: false })
  }
})

app.use('/api/v1/auth', authRouter)
app.use('/api/v1/profile', profileRouter)
app.use('/api/v1/uploads', uploadsRouter)
app.use('/api/v1/owner-checks', ownerChecksRouter)
app.use('/api/v1/notifications', notificationsRouter)
app.use('/api/v1/matches', matchesRouter)
app.use('/api/v1/reports', reportsRouter)
app.use('/api/v1/privacy-requests', privacyRequestsRouter)
app.use('/api/v1/admin', adminRouter)
app.use('/api/v1/ads', listingsRouter)

app.use((error, req, res, next) => {
  writeErrorLog(error, req)
  if (res.headersSent) return next(error)
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500
  res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_request' })
})

startMatchingScheduler()
startUploadCleanup()
startOutboxWorker()
startAccountDeletionWorker()

app.listen(port, () => {
  console.log(`[server] Lost&Found API started at http://localhost:${port}`)
  console.log(`[server] CORS origin: ${frontOrigin}`)
})

