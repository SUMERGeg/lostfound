import { randomUUID } from 'node:crypto'
import pool from '../db.js'
import { MATCH_THRESHOLD } from '../matching.js'

export const MATCH_FEEDBACK_VALUES = ['CONFIRMED', 'SIMILAR_NOT_MINE', 'NOT_RELEVANT']

export class MatchError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function listMatches(userId, { database = pool, limit = 100 } = {}) {
  const pageSize = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
  const [rows] = await database.query(
    `SELECT m.id, m.score, m.algorithm_version AS algorithmVersion,
            m.score_breakdown AS scoreBreakdown, m.created_at AS createdAt,
            m.updated_at AS updatedAt, mf.feedback,
            lost.id AS lostId, lost.title AS lostTitle, lost.category,
            lost.occurred_at AS lostOccurredAt,
            (SELECT url FROM photos WHERE listing_id = lost.id ORDER BY created_at ASC LIMIT 1) AS lostPhoto,
            found.id AS foundId, found.title AS foundTitle,
            found.occurred_at AS foundOccurredAt,
            (SELECT url FROM photos WHERE listing_id = found.id ORDER BY created_at ASC LIMIT 1) AS foundPhoto,
            lost.author_id = ? AS ownsLost,
            found.author_id = ? AS ownsFound
     FROM matches m
     JOIN listings lost ON lost.id = m.lost_id
     JOIN listings found ON found.id = m.found_id
     LEFT JOIN match_feedback mf ON mf.match_id = m.id AND mf.user_id = ?
     WHERE (lost.author_id = ? OR found.author_id = ?)
       AND lost.status = 'ACTIVE' AND found.status = 'ACTIVE'
       AND m.score >= ?
     ORDER BY m.score DESC, m.updated_at DESC, m.id ASC
     LIMIT ?`,
    [userId, userId, userId, userId, userId, MATCH_THRESHOLD, pageSize]
  )
  return rows.map(mapMatchRow)
}

export async function saveMatchFeedback({ matchId, userId, feedback }, { database = pool } = {}) {
  const normalized = String(feedback ?? '').toUpperCase()
  if (!MATCH_FEEDBACK_VALUES.includes(normalized)) {
    throw new MatchError('invalid_feedback', 'Unknown match feedback value')
  }
  const [result] = await database.query(
    `INSERT INTO match_feedback (id, match_id, user_id, feedback)
     SELECT ?, m.id, ?, ?
     FROM matches m
     JOIN listings lost ON lost.id = m.lost_id
     JOIN listings found ON found.id = m.found_id
     WHERE m.id = ? AND (lost.author_id = ? OR found.author_id = ?)
     ON DUPLICATE KEY UPDATE feedback = VALUES(feedback), updated_at = CURRENT_TIMESTAMP`,
    [randomUUID(), userId, normalized, matchId, userId, userId]
  )
  if (result.affectedRows === 0) throw new MatchError('not_found', 'Match not found', 404)
  return normalized
}

function mapMatchRow(row) {
  return {
    id: row.id,
    score: Number(row.score),
    algorithmVersion: row.algorithmVersion,
    scoreBreakdown: parseJson(row.scoreBreakdown),
    feedback: row.feedback ?? null,
    ownsLost: Boolean(row.ownsLost),
    ownsFound: Boolean(row.ownsFound),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lost: { id: row.lostId, title: row.lostTitle, category: row.category, occurredAt: row.lostOccurredAt, photo: row.lostPhoto },
    found: { id: row.foundId, title: row.foundTitle, category: row.category, occurredAt: row.foundOccurredAt, photo: row.foundPhoto }
  }
}

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return null }
}
