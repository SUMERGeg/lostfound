import { randomUUID } from 'node:crypto'
import pool from '../db.js'
import { createActionToken } from '../auth/actionTokens.js'
import { createEmailProvider } from './provider.js'

export async function processNextOutboxEvent(dependencies = {}) {
  const database = dependencies.database ?? pool
  const provider = dependencies.provider ?? createEmailProvider()
  const connection = await database.getConnection()
  const lockToken = randomUUID()
  let event

  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      `SELECT id, event_type, payload, attempt_count
       FROM outbox_events
       WHERE processed_at IS NULL
         AND available_at <= CURRENT_TIMESTAMP
         AND (locked_at IS NULL OR locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE))
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    )
    event = rows[0]
    if (!event) {
      await connection.commit()
      return false
    }
    await connection.query(
      'UPDATE outbox_events SET locked_at = CURRENT_TIMESTAMP, lock_token = ? WHERE id = ?',
      [lockToken, event.id]
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  try {
    await provider.send(renderEmail(event, dependencies))
    await database.query(
      `UPDATE outbox_events
       SET processed_at = CURRENT_TIMESTAMP, locked_at = NULL, lock_token = NULL, last_error = NULL
       WHERE id = ? AND lock_token = ?`,
      [event.id, lockToken]
    )
  } catch (error) {
    const delayMinutes = Math.min(60, 2 ** Math.min(Number(event.attempt_count ?? 0), 5))
    await database.query(
      `UPDATE outbox_events
       SET attempt_count = attempt_count + 1,
           available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE),
           locked_at = NULL, lock_token = NULL, last_error = ?
       WHERE id = ? AND lock_token = ?`,
      [delayMinutes, String(error.message).slice(0, 1000), event.id, lockToken]
    )
    throw error
  }
  return true
}

export function startOutboxWorker({ schedule = setInterval, intervalMs = 5000 } = {}) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      while (await processNextOutboxEvent()) {
        // Drain the available batch one event at a time to keep leases simple.
      }
    } catch (error) {
      console.error('[outbox] worker failed', { error: error.message })
    } finally {
      running = false
    }
  }
  const timer = schedule(run, intervalMs)
  timer.unref?.()
  return timer
}

function renderEmail(event, dependencies) {
  const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
  const origin = (dependencies.frontOrigin ?? process.env.FRONT_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '')
  const secret = dependencies.emailTokenSecret
  if (event.event_type === 'AUTH_EMAIL_VERIFICATION') {
    const token = createActionToken(payload.tokenId, 'verify-email', secret)
    const url = `${origin}/verify-email?token=${encodeURIComponent(token)}`
    return message(payload, 'Подтвердите email', 'verify-email', `Подтвердить email: ${url}`, `<p>Подтвердите email:</p><p><a href="${escapeHtml(url)}">Подтвердить</a></p>`)
  }
  if (event.event_type === 'AUTH_PASSWORD_RESET') {
    const token = createActionToken(payload.tokenId, 'reset-password', secret)
    const url = `${origin}/reset-password?token=${encodeURIComponent(token)}`
    return message(payload, 'Сброс пароля', 'reset-password', `Сбросить пароль: ${url}`, `<p>Сбросить пароль:</p><p><a href="${escapeHtml(url)}">Сбросить пароль</a></p>`)
  }
  throw new Error(`Unsupported outbox event: ${event.event_type}`)
}

function message(payload, subject, template, text, html) {
  return { to: payload.email, subject, template, text, html }
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
