import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import listingsRouter from './listings.js'
import webhookRouter from './webhook.js'
import { startMatchingScheduler } from './cron.js'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 8080)
const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:5173'

app.use(
  cors({
    origin: appBaseUrl,
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
})

