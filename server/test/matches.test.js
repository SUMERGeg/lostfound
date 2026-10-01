import assert from 'node:assert/strict'
import test from 'node:test'

import { runMatchingJob } from '../src/cron.js'
import { listMatches, MatchError, saveMatchFeedback } from '../src/matches/service.js'

test('lists only participant matches and parses score breakdown', async () => {
  let captured
  const database = {
    async query(sql, params) {
      captured = { sql: String(sql), params }
      return [[{
        id: 'match-1', score: 85, algorithmVersion: 'baseline-v1',
        scoreBreakdown: '{"total":85}', feedback: 'CONFIRMED', ownsLost: 1, ownsFound: 0,
        lostId: 'lost-1', lostTitle: 'Красный рюкзак', category: 'bags', lostOccurredAt: null, lostPhoto: null,
        foundId: 'found-1', foundTitle: 'Найден рюкзак', foundOccurredAt: null, foundPhoto: null
      }]]
    }
  }

  const rows = await listMatches('user-1', { database, limit: 500 })
  assert.equal(captured.sql.includes('(lost.author_id = ? OR found.author_id = ?)'), true)
  assert.equal(captured.params.at(-1), 100)
  assert.deepEqual(rows[0].scoreBreakdown, { total: 85 })
  assert.equal(rows[0].ownsLost, true)
})

test('feedback uses an ownership-bound upsert', async () => {
  let captured
  const database = {
    async query(sql, params) {
      captured = { sql: String(sql), params }
      return [{ affectedRows: 1 }]
    }
  }

  const value = await saveMatchFeedback({ matchId: 'match-1', userId: 'user-1', feedback: 'confirmed' }, { database })
  assert.equal(value, 'CONFIRMED')
  assert.equal(captured.sql.includes('lost.author_id = ? OR found.author_id = ?'), true)
  assert.deepEqual(captured.params.slice(-3), ['match-1', 'user-1', 'user-1'])
})

test('feedback rejects strangers and unknown values', async () => {
  const database = { async query() { return [{ affectedRows: 0 }] } }
  await assert.rejects(
    saveMatchFeedback({ matchId: 'match-1', userId: 'stranger', feedback: 'CONFIRMED' }, { database }),
    error => error instanceof MatchError && error.status === 404
  )
  await assert.rejects(
    saveMatchFeedback({ matchId: 'match-1', userId: 'user-1', feedback: 'MAYBE' }, { database }),
    error => error instanceof MatchError && error.code === 'invalid_feedback'
  )
})

test('matching job hard-filters candidates, upserts metadata and notifies both owners once', async () => {
  const queries = []
  const connection = {
    async beginTransaction() { queries.push('begin') },
    async query(sql, params) {
      queries.push({ sql: String(sql), params })
      if (String(sql).includes('INSERT INTO matches')) return [{ affectedRows: 1 }]
      return [{ affectedRows: 1 }]
    },
    async commit() { queries.push('commit') },
    async rollback() { queries.push('rollback') },
    release() { queries.push('release') }
  }
  const database = {
    async query(sql) {
      assert.equal(String(sql).includes('found.category = lost.category'), true)
      return [[candidate()]]
    },
    async getConnection() { return connection }
  }

  const result = await runMatchingJob({ database, logger: {} })
  assert.deepEqual(result, { evaluated: 1, created: 1, updated: 0 })
  const matchWrite = queries.find(item => item.sql?.includes('INSERT IGNORE INTO matches'))
  assert.equal(matchWrite.sql.includes('INSERT IGNORE INTO matches'), true)
  assert.equal(matchWrite.params[4], 'baseline-v1')
  assert.equal(JSON.parse(matchWrite.params[5]).total, 85)
  assert.equal(queries.filter(item => item.sql?.includes('INSERT INTO notifications')).length, 2)
})

test('matching job reports and propagates database failures', async () => {
  const errors = []
  const connection = {
    async beginTransaction() {},
    async query() { throw new Error('database unavailable') },
    async rollback() {},
    release() {}
  }
  const database = {
    async query() { return [[candidate()]] },
    async getConnection() { return connection }
  }

  await assert.rejects(runMatchingJob({ database, logger: { error: (...args) => errors.push(args) } }), /database unavailable/)
  assert.equal(errors.length, 1)
})

function candidate() {
  return {
    lost_id: 'lost-1', lost_author_id: 'lost-owner', lost_category: 'bags',
    lost_title: 'red backpack', lost_occurred_at: '2026-08-12T12:00:00Z', lost_lat: 55.75, lost_lng: 37.61,
    found_id: 'found-1', found_author_id: 'found-owner', found_category: 'bags',
    found_title: 'found red backpack', found_occurred_at: '2026-08-12T12:00:00Z', found_lat: 55.75, found_lng: 37.61
  }
}
