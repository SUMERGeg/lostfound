import crypto from 'node:crypto'
import cron from 'node-cron'
import { pool } from './db.js'
import { evaluateMatch, MATCH_THRESHOLD } from './matching.js'
import { insertNotification, NotificationStatus, NotificationType } from './notifications.js'

let jobRunning = false

export async function runMatchingJob({ database = pool, logger = console } = {}) {
  const [candidates] = await database.query(
    `SELECT lost.id AS lost_id, lost.author_id AS lost_author_id,
            lost.category AS lost_category, lost.title AS lost_title,
            lost.occurred_at AS lost_occurred_at, lost.lat AS lost_lat, lost.lng AS lost_lng,
            found.id AS found_id, found.author_id AS found_author_id,
            found.category AS found_category, found.title AS found_title,
            found.occurred_at AS found_occurred_at, found.lat AS found_lat, found.lng AS found_lng
     FROM listings lost
     JOIN listings found
       ON found.type = 'FOUND' AND found.status = 'ACTIVE'
      AND found.category = lost.category
      AND found.author_id <> lost.author_id
     WHERE lost.type = 'LOST' AND lost.status = 'ACTIVE'
     ORDER BY lost.id ASC, found.id ASC`
  )

  let created = 0
  let updated = 0
  for (const candidate of candidates) {
    const result = evaluateMatch(mapListing(candidate, 'lost'), mapListing(candidate, 'found'))
    if (!result.eligible || result.score < MATCH_THRESHOLD) continue

    const connection = await database.getConnection()
    try {
      await connection.beginTransaction()
      const matchId = crypto.randomUUID()
      const [write] = await connection.query(
        `INSERT IGNORE INTO matches (id, lost_id, found_id, score, algorithm_version, score_breakdown)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [matchId, candidate.lost_id, candidate.found_id, result.score, result.algorithmVersion, JSON.stringify(result.breakdown)]
      )
      if (write.affectedRows === 1) {
        await notifyMatch(connection, candidate, matchId, result.score)
        created += 1
      } else {
        await connection.query(
          `UPDATE matches
           SET score = ?, algorithm_version = ?, score_breakdown = ?, updated_at = CURRENT_TIMESTAMP
           WHERE lost_id = ? AND found_id = ?`,
          [result.score, result.algorithmVersion, JSON.stringify(result.breakdown), candidate.lost_id, candidate.found_id]
        )
        updated += 1
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      logger.error?.('[matching] candidate failed', {
        lostId: candidate.lost_id,
        foundId: candidate.found_id,
        error: error?.message ?? 'unknown error'
      })
      throw error
    } finally {
      connection.release()
    }
  }

  logger.info?.(`[matching] evaluated ${candidates.length}; created ${created}; updated ${updated}`)
  return { evaluated: candidates.length, created, updated }
}

export function startMatchingScheduler() {
  cron.schedule('*/10 * * * *', async () => {
    if (jobRunning) return console.warn('[matching] previous run is still active; skipping overlap')
    jobRunning = true
    try {
      await runMatchingJob()
    } catch (error) {
      console.error('[matching] scheduled run failed', error)
    } finally {
      jobRunning = false
    }
  })
  console.log('[cron] Matching scheduler started (every 10 min)')
}

async function notifyMatch(connection, candidate, matchId, score) {
  for (const userId of new Set([candidate.lost_author_id, candidate.found_author_id])) {
    await insertNotification(connection, {
      userId,
      type: NotificationType.MATCH_FOUND,
      title: 'Найдено потенциальное совпадение',
      body: `Оценка совпадения: ${score} из 100.`,
      status: NotificationStatus.UNREAD,
      listingId: userId === candidate.lost_author_id ? candidate.lost_id : candidate.found_id,
      payload: { matchId }
    })
  }
}

function mapListing(candidate, prefix) {
  return {
    category: candidate[`${prefix}_category`],
    title: candidate[`${prefix}_title`],
    occurred_at: candidate[`${prefix}_occurred_at`],
    lat: candidate[`${prefix}_lat`],
    lng: candidate[`${prefix}_lng`]
  }
}
