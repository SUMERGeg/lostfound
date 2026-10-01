import assert from 'node:assert/strict'
import test from 'node:test'

import { createActionToken, hashActionToken, validateActionToken } from '../src/auth/actionTokens.js'
import { requestPasswordReset, resetPassword, verifyEmail } from '../src/auth/emailService.js'
import { processNextOutboxEvent } from '../src/email/outboxWorker.js'

const SECRET = 'different-test-email-secret-with-more-than-32-bytes'

test('action tokens are purpose-bound and stored as hashes', () => {
  const token = createActionToken('token-id', 'verify-email', SECRET)
  assert.equal(validateActionToken(token, 'verify-email', SECRET).tokenId, 'token-id')
  assert.throws(() => validateActionToken(token, 'reset-password', SECRET), /Invalid token/)
  assert.equal(hashActionToken(token).length, 64)
  assert.equal(hashActionToken(token).includes(token), false)
})

test('password reset request is indistinguishable for an unknown email', async () => {
  const { database, calls } = transactionalDatabase({ selectRows: [] })
  await requestPasswordReset('unknown@example.com', { database, emailTokenSecret: SECRET })
  assert.equal(calls.some(call => String(call.sql).includes('password_reset_tokens')), false)
  assert.equal(calls.some(call => call.action === 'commit'), true)
})

test('verifies an unexpired single-use email token', async () => {
  const rawToken = createActionToken('verify-1', 'verify-email', SECRET)
  const { database, calls } = transactionalDatabase({
    selectRows: [{ user_id: 'user-1', expires_at: new Date(Date.now() + 60_000), used_at: null }]
  })
  const result = await verifyEmail(rawToken, { database, emailTokenSecret: SECRET })
  assert.deepEqual(result, { userId: 'user-1' })
  assert.equal(calls.some(call => String(call.sql).includes('email_verified_at')), true)
  assert.equal(calls.some(call => call.action === 'commit'), true)
})

test('password reset changes the hash and revokes every refresh session', async () => {
  const rawToken = createActionToken('reset-1', 'reset-password', SECRET)
  const { database, calls } = transactionalDatabase({
    selectRows: [{ user_id: 'user-1', expires_at: new Date(Date.now() + 60_000), used_at: null }]
  })
  await resetPassword({ token: rawToken, password: 'a new secure password' }, { database, emailTokenSecret: SECRET })
  const passwordUpdate = calls.find(call => String(call.sql).includes('SET password_hash'))
  assert.match(passwordUpdate.params[0], /^scrypt\$/)
  assert.equal(calls.some(call => String(call.sql).includes('refresh_sessions')), true)
})

test('outbox worker sends reconstructed link and marks event processed', async () => {
  const sent = []
  const updates = []
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      if (String(sql).includes('SELECT id, event_type')) {
        return [[{
          id: 'event-1',
          event_type: 'AUTH_EMAIL_VERIFICATION',
          payload: JSON.stringify({ email: 'person@example.com', tokenId: 'token-1' }),
          attempt_count: 0
        }]]
      }
      return [{ affectedRows: 1 }]
    },
    async commit() {}, async rollback() {}, release() {}
  }
  const database = {
    async getConnection() { return connection },
    async query(sql, params) { updates.push([sql, params]); return [{ affectedRows: 1 }] }
  }
  const processed = await processNextOutboxEvent({
    database,
    provider: { async send(message) { sent.push(message) } },
    emailTokenSecret: SECRET,
    frontOrigin: 'https://lostfound.example'
  })
  assert.equal(processed, true)
  assert.match(sent[0].text, /https:\/\/lostfound\.example\/verify-email\?token=/)
  assert.equal(updates.some(update => String(update[0]).includes('processed_at')), true)
})

function transactionalDatabase({ selectRows }) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push({ action: 'begin' }) },
    async query(sql, params = []) {
      calls.push({ action: 'query', sql, params })
      if (String(sql).trimStart().startsWith('SELECT')) return [selectRows]
      return [{ affectedRows: 1 }]
    },
    async commit() { calls.push({ action: 'commit' }) },
    async rollback() { calls.push({ action: 'rollback' }) },
    release() { calls.push({ action: 'release' }) }
  }
  return { calls, database: { async getConnection() { return connection } } }
}
