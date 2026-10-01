import assert from 'node:assert/strict'
import test from 'node:test'

import { ImageValidationError, MAX_IMAGE_BYTES, validateImage } from '../src/uploads/imageValidation.js'
import { attachImages, storeImage } from '../src/uploads/service.js'

test('detects JPEG by file signature instead of trusting its name', () => {
  const detected = validateImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')
  assert.equal(detected.contentType, 'image/jpeg')
  assert.equal(detected.extension, 'jpg')
})

test('rejects executable content and MIME mismatches', () => {
  assert.throws(() => validateImage(Buffer.from('MZ executable'), 'image/jpeg'), ImageValidationError)
  assert.throws(
    () => validateImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/png'),
    /does not match/
  )
  assert.throws(() => validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'), /8 MB/)
})

test('stores object metadata without persisting file bytes', async () => {
  const calls = []
  const storage = {
    async put(input) { calls.push(['put', input]); return 'https://cdn.example/image.jpg' },
    async delete(key) { calls.push(['delete', key]) }
  }
  const database = {
    async query(sql, params) { calls.push(['query', sql, params]); return [{ affectedRows: 1 }] }
  }
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0x00])
  const upload = await storeImage({ ownerId: 'user-1', buffer, contentType: 'image/jpeg' }, { database, storage })

  assert.equal(upload.url, 'https://cdn.example/image.jpg')
  const insert = calls.find(call => call[0] === 'query')
  assert.equal(insert[2].includes(buffer), false)
  assert.equal(insert[2][5], buffer.length)
})

test('attaches only pending uploads owned by the listing owner', async () => {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push(['begin']) },
    async query(sql, params) {
      calls.push(['query', sql, params])
      if (String(sql).startsWith('SELECT 1 FROM listings')) return [[{ owned: 1 }]]
      if (String(sql).includes("status = 'PENDING'")) return [[{ id: 'upload-1', public_url: 'https://cdn.example/1.jpg' }]]
      if (String(sql).includes("status = 'ATTACHED' FOR UPDATE")) return [[]]
      return [{ affectedRows: 1 }]
    },
    async commit() { calls.push(['commit']) },
    async rollback() { calls.push(['rollback']) },
    release() { calls.push(['release']) }
  }
  const database = { async getConnection() { return connection } }
  const storage = { async delete() {} }

  const result = await attachImages({ ownerId: 'user-1', listingId: 'listing-1', uploadIds: ['upload-1'] }, { database, storage })
  assert.equal(result, true)
  const select = calls.find(call => call[0] === 'query' && String(call[1]).includes("status = 'PENDING'"))
  assert.deepEqual(select[2], ['user-1', 'upload-1'])
  assert.equal(calls.some(call => call[0] === 'commit'), true)
})

test('does not attach uploads to a foreign listing', async () => {
  const connection = {
    async beginTransaction() {},
    async query(sql) { return String(sql).startsWith('SELECT 1 FROM listings') ? [[]] : [{ affectedRows: 1 }] },
    async commit() { assert.fail('must not commit') },
    async rollback() {},
    release() {}
  }
  const result = await attachImages(
    { ownerId: 'user-1', listingId: 'foreign-listing', uploadIds: ['upload-1'] },
    { database: { async getConnection() { return connection } }, storage: { async delete() {} } }
  )
  assert.equal(result, false)
})
