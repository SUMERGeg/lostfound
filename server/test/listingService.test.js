import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createListing,
  ListingValidationError,
  replaceListingPhotos,
  setListingStatus,
  toggleListingStatus,
  updateListingDetails,
  updateListingLocation,
  updateListingTitle
} from '../src/listingService.js'

test('updates a validated set of listing fields with one ownership-bound query', async () => {
  const calls = []
  const database = {
    async query(sql, params) {
      calls.push([sql, params])
      return [{ affectedRows: 1 }]
    }
  }

  const updated = await updateListingDetails('listing-1', 'user-1', {
    title: '  Новый заголовок  ',
    description: ' Новое описание ',
    category: 'keys',
    occurredAt: '2026-08-12T12:00:00Z',
    lat: 55.75,
    lng: 37.61
  }, { database })

  assert.equal(updated, true)
  assert.match(calls[0][0], /WHERE id = \? AND author_id = \?/)
  assert.deepEqual(calls[0][1].slice(0, 5), [
    'Новый заголовок',
    'keys',
    'Новое описание',
    '2026-08-12 12:00:00',
    55.75
  ])
})

test('requires latitude and longitude to be edited together', async () => {
  await assert.rejects(
    updateListingDetails('listing-1', 'user-1', { lat: 55.75 }),
    error => error instanceof ListingValidationError && /together/.test(error.message)
  )
})

function databaseDouble({ failAtQuery = null } = {}) {
  const calls = []
  let queryNumber = 0
  const connection = {
    async beginTransaction() {
      calls.push(['begin'])
    },
    async query(sql, params) {
      queryNumber += 1
      calls.push(['query', sql, params])
      if (queryNumber === failAtQuery) {
        throw new Error('database failure')
      }
      return [{ affectedRows: 1 }]
    },
    async commit() {
      calls.push(['commit'])
    },
    async rollback() {
      calls.push(['rollback'])
    },
    release() {
      calls.push(['release'])
    }
  }

  return {
    calls,
    database: {
      async getConnection() {
        calls.push(['getConnection'])
        return connection
      }
    }
  }
}

function ids() {
  let next = 0
  return () => `id-${++next}`
}

test('creates listing, photos and secrets in one transaction', async () => {
  const { database, calls } = databaseDouble()

  const id = await createListing(
    {
      authorId: 'user-1',
      payload: {
        type: 'lost',
        category: 'keys',
        title: '  Keys  ',
        description: 'near the park',
        lat: '55.75',
        lng: 37.61,
        photos: ['https://example.test/1.jpg'],
        secrets: [{ question: 'Mark?', cipher: { type: 'test' } }]
      }
    },
    { database, idFactory: ids() }
  )

  assert.equal(id, 'id-1')
  assert.deepEqual(calls.map(call => call[0]), [
    'getConnection',
    'begin',
    'query',
    'query',
    'query',
    'commit',
    'release'
  ])
  assert.equal(calls[2][2][1], 'user-1')
  assert.equal(calls[2][2][2], 'LOST')
  assert.equal(calls[2][2][4], 'Keys')
  assert.equal(calls[2][2][6], 55.75)
})

test('rolls back the whole aggregate when a related insert fails', async () => {
  const { database, calls } = databaseDouble({ failAtQuery: 2 })

  await assert.rejects(
    createListing(
      {
        authorId: 'user-1',
        payload: {
          type: 'FOUND',
          category: 'keys',
          title: 'Keys',
          contactChannels: ['EMAIL'],
          photos: ['https://example.test/1.jpg']
        }
      },
      { database, idFactory: ids() }
    ),
    /database failure/
  )

  assert.deepEqual(calls.map(call => call[0]), [
    'getConnection',
    'begin',
    'query',
    'query',
    'rollback',
    'release'
  ])
})

test('rejects invalid input before acquiring a database connection', async () => {
  const { database, calls } = databaseDouble()

  await assert.rejects(
    createListing(
      { authorId: 'user-1', payload: { type: 'OTHER', category: 'keys', title: 'Keys' } },
      { database, idFactory: ids() }
    ),
    ListingValidationError
  )

  assert.deepEqual(calls, [])
})

test('keeps the existing three-photo and three-secret publication limit', async () => {
  const { database, calls } = databaseDouble()

  await createListing(
    {
      authorId: 'user-1',
      payload: {
        type: 'FOUND',
        category: 'keys',
        title: 'Keys',
        contactChannels: ['EMAIL'],
        photos: ['1', '2', '3', '4'],
        secrets: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]
      }
    },
    { database, idFactory: ids() }
  )

  const queries = calls.filter(call => call[0] === 'query')
  assert.equal(queries.length, 8)
})

test('requires at least one contact channel for FOUND listings', async () => {
  const { database, calls } = databaseDouble()
  await assert.rejects(
    createListing({ authorId: 'user-1', payload: { type: 'FOUND', category: 'keys', title: 'Keys', contactChannels: [] } }, { database }),
    error => error instanceof ListingValidationError && /at least one/.test(error.message)
  )
  assert.deepEqual(calls, [])
})

test('stores selected contact disclosure channels without contact values', async () => {
  const { database, calls } = databaseDouble()
  await createListing(
    { authorId: 'user-1', payload: { type: 'FOUND', category: 'keys', title: 'Keys', contactChannels: ['TELEGRAM'] } },
    { database, idFactory: ids() }
  )
  const preferenceInsert = calls.find(call => call[0] === 'query' && String(call[1]).includes('INSERT INTO listing_contact_preferences'))
  assert.deepEqual(preferenceInsert[2], ['id-1', false, false, true])
  assert.equal(JSON.stringify(preferenceInsert).includes('@'), false)
})

test('updates only a listing owned by the authenticated user', async () => {
  const calls = []
  const database = {
    async query(sql, params) {
      calls.push([sql, params])
      return [{ affectedRows: params.at(-1) === 'owner-1' ? 1 : 0 }]
    }
  }

  assert.equal(await updateListingTitle('listing-1', 'owner-1', ' New title ', { database }), true)
  assert.equal(await setListingStatus('listing-1', 'other-user', 'CLOSED', { database }), false)
  assert.equal(calls[0][1][0], 'New title')
  assert.deepEqual(calls[0][1].slice(-2), ['listing-1', 'owner-1'])
  assert.deepEqual(calls[1][1].slice(-2), ['listing-1', 'other-user'])
})

test('validates coordinates and status before executing an update', async () => {
  const database = {
    async query() {
      throw new Error('query should not run')
    }
  }

  await assert.rejects(
    updateListingLocation('listing-1', 'owner-1', 'invalid', 37.61, { database }),
    ListingValidationError
  )
  await assert.rejects(
    setListingStatus('listing-1', 'owner-1', 'DELETED', { database }),
    ListingValidationError
  )
})

test('toggles status under an ownership lock', async () => {
  const { database, calls } = databaseDouble()
  const originalGetConnection = database.getConnection
  database.getConnection = async () => {
    const connection = await originalGetConnection()
    connection.query = async (sql, params) => {
      calls.push(['query', sql, params])
      if (sql.startsWith('SELECT status')) {
        return [[{ status: 'ACTIVE' }]]
      }
      return [{ affectedRows: 1 }]
    }
    return connection
  }

  assert.equal(await toggleListingStatus('listing-1', 'owner-1', { database }), 'CLOSED')
  assert.match(calls[2][1], /FOR UPDATE/)
  assert.deepEqual(calls[3][2], ['CLOSED', 'listing-1', 'owner-1'])
})

test('does not replace photos for a foreign listing', async () => {
  const { database, calls } = databaseDouble()
  const originalGetConnection = database.getConnection
  database.getConnection = async () => {
    const connection = await originalGetConnection()
    connection.query = async (sql, params) => {
      calls.push(['query', sql, params])
      return [[]]
    }
    return connection
  }

  assert.equal(
    await replaceListingPhotos('listing-1', 'other-user', ['https://example.test/1.jpg'], { database }),
    false
  )
  assert.deepEqual(calls.map(call => call[0]), [
    'getConnection',
    'begin',
    'query',
    'rollback',
    'release'
  ])
})

test('rolls back photo replacement when an insert fails', async () => {
  const { database, calls } = databaseDouble()
  const originalGetConnection = database.getConnection
  let queryNumber = 0
  database.getConnection = async () => {
    const connection = await originalGetConnection()
    connection.query = async (sql, params) => {
      queryNumber += 1
      calls.push(['query', sql, params])
      if (queryNumber === 1) return [[{ owned: 1 }]]
      if (queryNumber === 3) throw new Error('photo insert failure')
      return [{ affectedRows: 1 }]
    }
    return connection
  }

  await assert.rejects(
    replaceListingPhotos('listing-1', 'owner-1', ['one', 'two'], { database, idFactory: ids() }),
    /photo insert failure/
  )
  assert.equal(calls.at(-2)[0], 'rollback')
  assert.equal(calls.at(-1)[0], 'release')
})
