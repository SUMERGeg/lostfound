import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import listingsRouter from './listings.js'
import webhookRouter from './webhook.js'
import { startMatchingScheduler } from './cron.js'
import { startBot } from './max.js'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 8080)
const frontOrigin = process.env.FRONT_ORIGIN ?? 'http://localhost:5173'

// CORS для фронтенда
app.use(
  cors({
    origin: [frontOrigin, 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
  })
)

app.use(express.json({ limit: '1mb' }))

app.get('/health', (req, res) => res.json({ ok: true }))

app.use('/listings', listingsRouter)
app.use('/webhook', webhookRouter)

startMatchingScheduler()

app.listen(port, () => {
  console.log(`[server] Lost&Found API запущен на http://localhost:${port}`)
  console.log(`[server] CORS разрешён для: ${frontOrigin}`)

  if (process.env.MAX_BOT_TOKEN) {
    console.log('[server] MAX Bot токен настроен ✓')
    startBot().catch(err => {
      console.error('[server] Ошибка запуска бота:', err)
    })
  } else {
    console.log('[server] ⚠️  MAX Bot токен не настроен (добавьте MAX_BOT_TOKEN в .env)')
  }
})

