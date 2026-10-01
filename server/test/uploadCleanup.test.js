import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanupExpiredUploads } from '../src/uploads/cleanup.js'

test('deletes expired pending objects and marks metadata deleted', async () => {
  const deletedKeys = []
  const database = {
    async query(sql, params) {
      if (String(sql).includes('SELECT id, object_key')) {
        return [[{ id: 'upload-1', object_key: 'uploads/user/upload.jpg' }]]
      }
      assert.deepEqual(params, ['upload-1'])
      return [{ affectedRows: 1 }]
    }
  }
  const storage = { async delete(key) { deletedKeys.push(key) } }

  const result = await cleanupExpiredUploads({ database, storage })
  assert.deepEqual(result, { scanned: 1, deleted: 1 })
  assert.deepEqual(deletedKeys, ['uploads/user/upload.jpg'])
})

test('keeps metadata pending when object deletion fails', async () => {
  let updateCalled = false
  const originalError = console.error
  console.error = () => {}
  try {
    const database = {
      async query(sql) {
        if (String(sql).includes('SELECT id, object_key')) return [[{ id: 'upload-1', object_key: 'bad-key' }]]
        updateCalled = true
        return [{ affectedRows: 1 }]
      }
    }
    const result = await cleanupExpiredUploads({
      database,
      storage: { async delete() { throw new Error('storage unavailable') } }
    })
    assert.deepEqual(result, { scanned: 1, deleted: 0 })
    assert.equal(updateCalled, false)
  } finally {
    console.error = originalError
  }
})
