import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateMatch, MATCH_ALGORITHM_VERSION, score } from '../src/matching.js'

function listing(overrides = {}) {
  return {
    category: 'bags',
    occurred_at: '2026-08-12T12:00:00.000Z',
    lat: 55.75,
    lng: 37.61,
    title: 'unique item',
    ...overrides
  }
}

test('current baseline combines category, time, nearby geo and title tokens', () => {
  const lost = listing({ title: 'red backpack' })
  const found = listing({ title: 'found red backpack' })

  assert.equal(score(lost, found), 85)
})

test('current time component loses one point for each complete six-hour interval', () => {
  const lost = listing({ title: 'alpha' })
  const found = listing({
    title: 'beta',
    occurred_at: '2026-08-13T00:00:00.000Z'
  })

  assert.equal(score(lost, found), 73)
})

test('current geo component uses 300 m, 1 km and 3 km buckets', () => {
  const lost = listing({ title: 'alpha' })

  assert.equal(score(lost, listing({ title: 'beta', lat: 55.751 })), 75)
  assert.equal(score(lost, listing({ title: 'beta', lat: 55.755 })), 65)
  assert.equal(score(lost, listing({ title: 'beta', lat: 55.77 })), 55)
  assert.equal(score(lost, listing({ title: 'beta', lat: 55.79 })), 45)
})

test('title component counts unique matching tokens only', () => {
  const lost = listing({ title: 'red bag', lat: 0, lng: 0 })
  const found = listing({ title: 'red red', lat: 10, lng: 10 })

  assert.equal(score(lost, found), 50)
})

test('missing dates remove only the time component instead of producing NaN', () => {
  const lost = listing({ occurred_at: null })
  const found = listing()

  const result = evaluateMatch(lost, found)
  assert.equal(result.score, 65)
  assert.deepEqual(result.breakdown.time, { score: 0, maximum: 20, available: false, hoursApart: null })
})

test('missing coordinates do not get interpreted as the equator', () => {
  const result = evaluateMatch(listing({ lat: null, lng: null }), listing({ lat: null, lng: null }))
  assert.deepEqual(result.breakdown.geo, { score: 0, maximum: 30, available: false, distanceKm: null })
  assert.equal(result.score, 55)
})

test('exposes deterministic versioned score breakdown', () => {
  const result = evaluateMatch(listing({ title: 'red backpack' }), listing({ title: 'found red backpack' }))

  assert.equal(result.algorithmVersion, MATCH_ALGORITHM_VERSION)
  assert.equal(result.breakdown.category.score, 25)
  assert.equal(result.breakdown.time.score, 20)
  assert.equal(result.breakdown.geo.score, 30)
  assert.deepEqual(result.breakdown.text.matchedTokens, ['backpack', 'red'])
  assert.equal(result.breakdown.total, 85)
})

test('different categories are rejected by the hard candidate rule', () => {
  const result = evaluateMatch(listing(), listing({ category: 'keys' }))
  assert.equal(result.eligible, false)
  assert.equal(result.score, 0)
})
