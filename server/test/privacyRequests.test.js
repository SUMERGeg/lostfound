import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPrivacyRequest,
  getPrivacyEmail,
  PrivacyRequestError,
  updatePrivacyRequest
} from '../src/privacyRequests/service.js'

test('anonymous privacy request normalizes email and returns only a receipt', async () => {
  const calls = []
  const database = { async query(sql, params) { calls.push([String(sql), params]); return [{ affectedRows: 1 }] } }
  const result = await createPrivacyRequest(
    { email: ' Person@Example.COM ', requestType: 'access', message: '  Please send my account data.  ' },
    { database, idFactory: () => 'request-1' }
  )

  assert.deepEqual(result, { id: 'request-1', status: 'NEW' })
  assert.deepEqual(calls[0][1], ['request-1', null, 'person@example.com', 'ACCESS', 'Please send my account data.'])
  assert.equal(JSON.stringify(result).includes('person@example.com'), false)
  assert.equal(JSON.stringify(result).includes('account data'), false)
})

test('authenticated privacy request trusts the active account email, not submitted email', async () => {
  const calls = []
  const database = {
    async query(sql, params) {
      calls.push([String(sql), params])
      if (String(sql).includes('SELECT email FROM users')) return [[{ email: 'owner@example.com' }]]
      return [{ affectedRows: 1 }]
    }
  }
  await createPrivacyRequest(
    { userId: 'user-1', email: 'attacker@example.com', requestType: 'DELETION', message: 'Delete all data tied to my account.' },
    { database, idFactory: () => 'request-2' }
  )

  assert.deepEqual(calls[1][1], ['request-2', 'user-1', 'owner@example.com', 'DELETION', 'Delete all data tied to my account.'])
})

test('privacy request rejects unsupported types and short messages before writing', async () => {
  const database = { async query() { throw new Error('must not query') } }
  await assert.rejects(
    createPrivacyRequest({ email: 'person@example.com', requestType: 'EXPORT_PASSWORDS', message: 'A long enough message' }, { database }),
    error => error instanceof PrivacyRequestError && error.code === 'invalid_request_type'
  )
  await assert.rejects(
    createPrivacyRequest({ email: 'person@example.com', requestType: 'OTHER', message: 'short' }, { database }),
    error => error instanceof PrivacyRequestError && error.code === 'invalid_message'
  )
})

test('admin transition is transactional and audits only status metadata', async () => {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push(['begin']) },
    async query(sql, params) { calls.push([String(sql), params]); return [{ affectedRows: 1 }] },
    async commit() { calls.push(['commit']) },
    async rollback() { calls.push(['rollback']) },
    release() { calls.push(['release']) }
  }
  const database = { async getConnection() { return connection } }
  const updated = await updatePrivacyRequest(
    { requestId: 'request-1', adminId: 'admin-1', status: 'RESOLVED', resolutionNote: 'Identity checked' },
    { database, idFactory: () => 'audit-1' }
  )

  assert.equal(updated, true)
  const audit = calls.find(call => String(call[0]).includes('INSERT INTO audit_log'))
  assert.deepEqual(audit[1], ['audit-1', 'admin-1', 'request-1', '{"status":"RESOLVED"}'])
  assert.equal(JSON.stringify(audit).includes('Identity checked'), false)
  assert.equal(calls.some(call => call[0] === 'commit'), true)
  assert.equal(calls.at(-1)[0], 'release')
})

test('terminal privacy request cannot be changed again', async () => {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async query() { return [{ affectedRows: 0 }] },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') }
  }
  const updated = await updatePrivacyRequest(
    { requestId: 'request-1', adminId: 'admin-1', status: 'IN_PROGRESS' },
    { database: { async getConnection() { return connection } } }
  )
  assert.equal(updated, false)
  assert.deepEqual(calls, ['begin', 'rollback', 'release'])
})

test('privacy contact has an explicit visible placeholder until configured', () => {
  assert.equal(getPrivacyEmail({}), '[PRIVACY_EMAIL]')
  assert.equal(getPrivacyEmail({ PRIVACY_EMAIL: ' privacy@example.com ' }), 'privacy@example.com')
})
