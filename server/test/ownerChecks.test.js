import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decideOwnerCheck,
  getOwnerCheckContacts,
  getPublicQuestions,
  OwnerCheckError,
  submitOwnerCheck
} from '../src/ownerChecks/service.js'

test('does not allow the FOUND author to claim their own item', async () => {
  const database = {
    async query(sql) {
      if (String(sql).includes('SELECT author_id FROM listings')) return [[{ author_id: 'holder-1' }]]
      return [[]]
    }
  }
  await assert.rejects(
    getPublicQuestions({ listingId: 'listing-1', claimantId: 'holder-1' }, { database }),
    error => error instanceof OwnerCheckError && error.code === 'self_claim'
  )
})

test('submits a complete answer snapshot for a foreign claimant', async () => {
  const calls = []
  const connection = transactionalConnection((sql) => {
    if (String(sql).includes('SELECT author_id FROM listings')) return [[{ author_id: 'holder-1' }]]
    if (String(sql).includes('SELECT id, prompt FROM owner_questions')) {
      return [[
        { id: 'q1', prompt: 'Какого цвета ремешок?' },
        { id: 'q2', prompt: 'Что внутри?' }
      ]]
    }
    return [{ affectedRows: 1 }]
  }, calls)
  const id = await submitOwnerCheck({
    listingId: 'listing-1',
    claimantId: 'claimant-1',
    answers: [
      { questionId: 'q1', answer: 'Синий' },
      { questionId: 'q2', answer: 'Карта' }
    ]
  }, { database: databaseWith(connection) })

  assert.equal(typeof id, 'string')
  const answerInserts = calls.filter(call => String(call.sql).includes('INSERT INTO owner_answers'))
  assert.equal(answerInserts.length, 2)
  assert.equal(answerInserts[0].params.includes('Какого цвета ремешок?'), true)
  assert.equal(calls.some(call => call.action === 'commit'), true)
})

test('rejects a partial set of owner-check answers', async () => {
  const connection = transactionalConnection((sql) => {
    if (String(sql).includes('SELECT author_id FROM listings')) return [[{ author_id: 'holder-1' }]]
    if (String(sql).includes('SELECT id, prompt FROM owner_questions')) return [[{ id: 'q1', prompt: 'One' }, { id: 'q2', prompt: 'Two' }]]
    return [{ affectedRows: 1 }]
  })
  await assert.rejects(
    submitOwnerCheck({ listingId: 'listing-1', claimantId: 'claimant-1', answers: [{ questionId: 'q1', answer: 'One' }] }, { database: databaseWith(connection) }),
    error => error instanceof OwnerCheckError && error.code === 'invalid_answers'
  )
})

test('approval snapshots contacts and closes the FOUND advertisement', async () => {
  const calls = []
  const connection = transactionalConnection((sql) => {
    if (String(sql).includes('SELECT listing_id FROM owner_checks')) return [[{ listing_id: 'listing-1' }]]
    if (String(sql).includes('SELECT claimant_id FROM owner_checks')) return [[{ claimant_id: 'claimant-1' }]]
    if (String(sql).includes('FROM users u')) return [[{
      email: 'holder@example.com',
      phone: '+79990000000',
      telegram: '@holder',
      allow_email: 0,
      allow_phone: 0,
      allow_telegram: 1
    }]]
    return [{ affectedRows: 1 }]
  }, calls)
  const decided = await decideOwnerCheck({ checkId: 'check-1', holderId: 'holder-1', decision: 'APPROVED' }, { database: databaseWith(connection) })
  assert.equal(decided, true)
  const snapshot = calls.find(call => String(call.sql).includes('INSERT INTO owner_check_contacts'))
  assert.deepEqual(snapshot.params, ['check-1', null, null, '@holder'])
  assert.equal(calls.some(call => String(call.sql).includes("SET status = 'CLOSED'")), true)
})

test('contacts remain unavailable before approval or to non-participants', async () => {
  const connection = transactionalConnection(() => [[]])
  await assert.rejects(
    getOwnerCheckContacts({ checkId: 'check-1', userId: 'stranger' }, { database: databaseWith(connection) }),
    error => error instanceof OwnerCheckError && error.code === 'contacts_unavailable' && error.status === 403
  )
})

test('approved participant receives only allowed contacts and disclosure audit contains types only', async () => {
  const calls = []
  const connection = transactionalConnection((sql) => {
    if (String(sql).includes('JOIN owner_check_contacts')) {
      return [[{ listing_id: 'listing-1', email: null, phone: null, telegram: '@holder' }]]
    }
    return [{ affectedRows: 1 }]
  }, calls)

  const contacts = await getOwnerCheckContacts(
    { checkId: 'check-1', userId: 'claimant-1' },
    { database: databaseWith(connection) }
  )

  assert.deepEqual(contacts, { email: null, phone: null, telegram: '@holder' })
  const audit = calls.find(call => String(call.sql).includes("'CONTACT_DISCLOSED'"))
  assert.ok(audit)
  assert.equal(audit.params[1], 'claimant-1')
  assert.equal(audit.params[2], 'check-1')
  assert.deepEqual(JSON.parse(audit.params[3]), { listingId: 'listing-1', contactTypes: ['TELEGRAM'] })
  assert.equal(audit.params[3].includes('@holder'), false)
  assert.equal(calls.some(call => call.action === 'commit'), true)
})

function transactionalConnection(resolver, calls = []) {
  return {
    async beginTransaction() { calls.push({ action: 'begin' }) },
    async query(sql, params = []) { calls.push({ action: 'query', sql, params }); return resolver(sql, params) },
    async commit() { calls.push({ action: 'commit' }) },
    async rollback() { calls.push({ action: 'rollback' }) },
    release() { calls.push({ action: 'release' }) }
  }
}

function databaseWith(connection) {
  return { async getConnection() { return connection } }
}
