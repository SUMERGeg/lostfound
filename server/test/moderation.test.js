import assert from 'node:assert/strict'
import test from 'node:test'

import { requireAdmin } from '../src/auth/middleware.js'
import { createReport, moderateListing, ModerationError, moderateUser, updateReport } from '../src/moderation/service.js'

test('admin middleware denies regular users', () => {
  let nextCalled = false
  const response = responseDouble()
  requireAdmin({ auth: { role: 'USER' } }, response, () => { nextCalled = true })
  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.body, { error: 'admin_required' })
  assert.equal(nextCalled, false)
})

test('report creation is bound to an active foreign advertisement', async () => {
  let captured
  const database = { async query(sql, params) { captured = { sql: String(sql), params }; return [{ affectedRows: 1 }] } }
  await createReport({ reporterId: 'user-1', listingId: 'listing-1', reason: 'spam', details: 'Repeated advertisement' }, { database })
  assert.equal(captured.sql.includes("l.status = 'ACTIVE' AND l.author_id <> ?"), true)
  assert.deepEqual(captured.params.slice(-2), ['listing-1', 'user-1'])
})

test('duplicate reports become a stable conflict', async () => {
  const database = { async query() { const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error } }
  await assert.rejects(
    createReport({ reporterId: 'user-1', listingId: 'listing-1', reason: 'FRAUD' }, { database }),
    error => error instanceof ModerationError && error.code === 'report_exists' && error.status === 409
  )
})

test('report transitions and listing moderation write audit rows transactionally', async () => {
  const reportCalls = []
  const reportConnection = connectionDouble(reportCalls)
  assert.equal(await updateReport({ reportId: 'report-1', adminId: 'admin-1', status: 'RESOLVED', resolutionNote: 'Handled' }, { database: databaseWith(reportConnection) }), true)
  assert.equal(reportCalls.some(call => call.sql?.includes('INSERT INTO audit_log')), true)
  assert.equal(reportCalls.includes('commit'), true)

  const listingCalls = []
  const listingConnection = connectionDouble(listingCalls)
  assert.equal(await moderateListing({ listingId: 'listing-1', adminId: 'admin-1', action: 'HIDE' }, { database: databaseWith(listingConnection) }), true)
  const update = listingCalls.find(call => call.sql?.includes('UPDATE listings SET status'))
  assert.deepEqual(update.params, ['HIDDEN', 'listing-1', 'ACTIVE'])
  assert.equal(listingCalls.some(call => call.sql?.includes('LISTING_HIDE')), false)
  assert.equal(listingCalls.some(call => call.params?.includes('LISTING_HIDE')), true)
})

test('blocking a user revokes sessions, hides active ads and is audited', async () => {
  const calls = []
  const connection = connectionDouble(calls)
  assert.equal(await moderateUser({ userId: 'user-1', adminId: 'admin-1', action: 'BLOCK' }, { database: databaseWith(connection) }), true)
  assert.equal(calls.some(call => call.sql?.includes('UPDATE refresh_sessions')), true)
  assert.equal(calls.some(call => call.sql?.includes("status = 'HIDDEN'")), true)
  assert.equal(calls.some(call => call.params?.includes('USER_BLOCK')), true)
})

test('administrator cannot block themselves', async () => {
  await assert.rejects(
    moderateUser({ userId: 'admin-1', adminId: 'admin-1', action: 'BLOCK' }),
    error => error instanceof ModerationError && error.code === 'self_moderation'
  )
})

test('resolved reports cannot be reopened through the moderation API', async () => {
  await assert.rejects(
    updateReport({ reportId: 'report-1', adminId: 'admin-1', status: 'OPEN' }),
    error => error instanceof ModerationError && error.code === 'invalid_transition' && error.status === 409
  )
})

function connectionDouble(calls) {
  return {
    async beginTransaction() { calls.push('begin') },
    async query(sql, params = []) { calls.push({ sql: String(sql), params }); return [{ affectedRows: 1 }] },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') }
  }
}

function databaseWith(connection) { return { async getConnection() { return connection } } }

function responseDouble() {
  return {
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this }
  }
}
