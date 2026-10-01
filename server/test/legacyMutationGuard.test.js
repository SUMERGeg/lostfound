import assert from 'node:assert/strict'
import test from 'node:test'

import { legacyMutationGuard } from '../src/legacyMutationGuard.js'

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    }
  }
}

function withEnvironment(values, callback) {
  const previous = {}
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  try {
    return callback()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('legacy mutations are disabled by default', () => {
  withEnvironment({ ENABLE_LEGACY_MUTATIONS: undefined, NODE_ENV: 'development' }, () => {
    const response = responseDouble()
    legacyMutationGuard({ get: () => undefined }, response, () => assert.fail('must not continue'))
    assert.equal(response.statusCode, 503)
    assert.equal(response.body.error, 'mutations_unavailable')
  })
})

test('legacy mutations can never be enabled in production', () => {
  withEnvironment({ ENABLE_LEGACY_MUTATIONS: 'true', NODE_ENV: 'production' }, () => {
    const response = responseDouble()
    legacyMutationGuard({ get: () => 'user-1' }, response, () => assert.fail('must not continue'))
    assert.equal(response.statusCode, 503)
  })
})

test('development legacy mode derives identity from the header, not request body', () => {
  withEnvironment({ ENABLE_LEGACY_MUTATIONS: 'true', NODE_ENV: 'development' }, () => {
    const request = {
      body: { authorId: 'attacker-controlled' },
      get: name => name === 'x-legacy-user-id' ? ' trusted-dev-user ' : undefined
    }
    const response = responseDouble()
    let continued = false

    legacyMutationGuard(request, response, () => {
      continued = true
    })

    assert.equal(continued, true)
    assert.deepEqual(request.auth, { userId: 'trusted-dev-user', legacyDevelopment: true })
  })
})
