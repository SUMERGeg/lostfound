import assert from 'node:assert/strict'
import test from 'node:test'

import { AccountDeletionError, objectKeyFromPublicUrl, requestAccountDeletion } from '../src/accountDeletion/service.js'
import { processNextAccountDeletionObject } from '../src/accountDeletion/worker.js'

function deletionDatabase({ passwordMatches = true } = {}) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push({ action: 'begin' }) },
    async query(sql, params = []) {
      calls.push({ action: 'query', sql: String(sql), params })
      if (String(sql).includes('FROM users') && String(sql).includes('FOR UPDATE')) {
        return [[{ id: 'user-1', password_hash: 'stored-hash' }]]
      }
      if (String(sql).startsWith('SELECT id FROM listings')) return [[{ id: 'listing-1' }]]
      if (String(sql).includes('SELECT object_key FROM uploads')) return [[{ object_key: 'uploads/user-1/photo.jpg' }]]
      if (String(sql).startsWith('SELECT url FROM photos')) return [[{ url: 'https://cdn.example/bucket/legacy%20photo.jpg' }]]
      if (String(sql).startsWith('SELECT id FROM owner_checks')) return [[{ id: 'check-1' }]]
      if (String(sql).startsWith('SELECT id FROM matches')) return [[{ id: 'match-1' }]]
      if (String(sql).startsWith('SELECT id FROM chats')) return [[{ id: 'chat-1' }]]
      return [{ affectedRows: 1 }]
    },
    async commit() { calls.push({ action: 'commit' }) },
    async rollback() { calls.push({ action: 'rollback' }) },
    release() { calls.push({ action: 'release' }) }
  }
  return {
    calls,
    database: { async getConnection() { return connection } },
    verifyPasswordFn: async (password, hash) => {
      calls.push({ action: 'verify', password, hash })
      return passwordMatches
    }
  }
}

test('account deletion atomically anonymizes the user and queues every object', async () => {
  const { database, calls, verifyPasswordFn } = deletionDatabase()
  const result = await requestAccountDeletion(
    { userId: 'user-1', currentPassword: 'correct-password', confirmation: 'DELETE' },
    { database, verifyPasswordFn, objectPublicBaseUrl: 'https://cdn.example/bucket' }
  )

  assert.equal(result.status, 'PENDING')
  assert.equal(result.queuedObjects, 2)
  assert.equal(calls.some(call => call.action === 'commit'), true)
  assert.equal(calls.some(call => call.sql?.includes('DELETE FROM refresh_sessions')), true)
  assert.equal(calls.some(call => call.sql?.includes('DELETE FROM email_verification_tokens')), true)
  assert.equal(calls.some(call => call.sql?.includes('DELETE FROM password_reset_tokens')), true)
  assert.equal(calls.some(call => call.sql?.includes('DELETE FROM outbox_events')), true)
  assert.equal(calls.some(call => call.sql?.includes('UPDATE privacy_requests SET user_id = NULL') && call.sql.includes("'[removed after account deletion]'")), true)
  assert.equal(calls.some(call => call.sql?.includes('UPDATE privacy_requests SET resolved_by = NULL')), true)
  assert.equal(calls.some(call => call.sql?.includes("status = 'DELETED'") && call.sql.includes('auth_version = auth_version + 1')), true)
  const queued = calls.find(call => call.sql?.includes('INSERT INTO account_deletion_objects'))
  assert.equal(queued.params[2], 'uploads/user-1/photo.jpg')
  assert.equal(calls.some(call => call.sql?.includes('INSERT INTO account_deletion_objects') && call.params[2] === 'legacy photo.jpg'), true)
  const audit = calls.find(call => call.sql?.includes("'ACCOUNT_DELETED'"))
  assert.ok(audit)
  assert.equal(audit.params.at(-1).includes('correct-password'), false)
})

test('legacy photo URLs are converted only when they belong to the configured bucket', () => {
  assert.equal(objectKeyFromPublicUrl('https://cdn.example/bucket/folder/a%20b.jpg', 'https://cdn.example/bucket/'), 'folder/a b.jpg')
  assert.equal(objectKeyFromPublicUrl('https://foreign.example/a.jpg', 'https://cdn.example/bucket'), null)
  assert.equal(objectKeyFromPublicUrl('https://cdn.example/bucket/%E0%A4%A', 'https://cdn.example/bucket'), null)
})

test('account deletion rejects an incorrect password without committing changes', async () => {
  const { database, calls, verifyPasswordFn } = deletionDatabase({ passwordMatches: false })
  await assert.rejects(
    requestAccountDeletion(
      { userId: 'user-1', currentPassword: 'wrong', confirmation: 'DELETE' },
      { database, verifyPasswordFn }
    ),
    error => error instanceof AccountDeletionError && error.code === 'invalid_password' && error.status === 403
  )
  assert.equal(calls.some(call => call.action === 'rollback'), true)
  assert.equal(calls.some(call => call.action === 'commit'), false)
  assert.equal(calls.some(call => call.sql?.includes('UPDATE users')), false)
})

function workerDatabase() {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push({ action: 'begin' }) },
    async query(sql, params = []) {
      calls.push({ action: 'connection-query', sql: String(sql), params })
      if (String(sql).includes('FROM account_deletion_objects')) {
        return [[{ id: 'object-1', job_id: 'job-1', object_key: 'uploads/user-1/photo.jpg', attempt_count: 0 }]]
      }
      return [{ affectedRows: 1 }]
    },
    async commit() { calls.push({ action: 'commit' }) },
    async rollback() { calls.push({ action: 'rollback' }) },
    release() { calls.push({ action: 'release' }) }
  }
  return {
    calls,
    database: {
      async getConnection() { return connection },
      async query(sql, params = []) {
        calls.push({ action: 'database-query', sql: String(sql), params })
        if (String(sql).startsWith('SELECT 1 FROM account_deletion_objects')) return [[]]
        return [{ affectedRows: 1 }]
      }
    }
  }
}

test('account deletion worker removes an object and completes its job', async () => {
  const { database, calls } = workerDatabase()
  const deleted = []
  const processed = await processNextAccountDeletionObject({
    database,
    storage: { async delete(key) { deleted.push(key) } },
    logger: { error() {} }
  })
  assert.equal(processed, true)
  assert.deepEqual(deleted, ['uploads/user-1/photo.jpg'])
  assert.equal(calls.some(call => call.sql?.includes("SET status = 'DELETED'")), true)
  assert.equal(calls.some(call => call.sql?.includes("account_deletion_jobs SET status = 'COMPLETED'")), true)
})

test('account deletion worker records a retry instead of hiding storage errors', async () => {
  const { database, calls } = workerDatabase()
  const errors = []
  const processed = await processNextAccountDeletionObject({
    database,
    storage: { async delete() { throw new Error('storage unavailable') } },
    logger: { error(message, metadata) { errors.push([message, metadata]) } }
  })
  assert.equal(processed, true)
  const retry = calls.find(call => call.sql?.includes('attempt_count = attempt_count + 1'))
  assert.ok(retry)
  assert.equal(retry.params[1], 'storage unavailable')
  assert.equal(errors.length, 1)
  assert.deepEqual(errors[0][1], { deletionId: 'job-1', objectId: 'object-1', attempt: 1 })
})
