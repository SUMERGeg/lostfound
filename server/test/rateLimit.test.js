import assert from 'node:assert/strict'
import test from 'node:test'

import { createRateLimit } from '../src/rateLimit.js'

test('limits requests per key and publishes retry time', () => {
  let currentTime = 1000
  const middleware = createRateLimit({ windowMs: 1000, max: 2, keyPrefix: 'test', now: () => currentTime })
  const request = { ip: '127.0.0.1' }
  const response = responseDouble()
  let accepted = 0
  middleware(request, response, () => { accepted += 1 })
  middleware(request, response, () => { accepted += 1 })
  middleware(request, response, () => { accepted += 1 })
  assert.equal(accepted, 2)
  assert.equal(response.statusCode, 429)
  assert.equal(response.headers['Retry-After'], '1')

  currentTime = 2000
  middleware(request, response, () => { accepted += 1 })
  assert.equal(accepted, 3)
})

function responseDouble() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}
