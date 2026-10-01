import assert from 'node:assert/strict'
import test from 'node:test'

import { requestContext, securityHeaders } from '../src/operational.js'

test('request context accepts only bounded safe request ids', () => {
  const response = responseDouble()
  const request = { get: () => 'trace-123', method: 'GET', originalUrl: '/api/v1/ads?secret=no' }
  requestContext(request, response, () => {})
  assert.equal(request.requestId, 'trace-123')
  assert.equal(response.headers['X-Request-Id'], 'trace-123')
})

test('security middleware adds browser hardening headers', () => {
  const response = responseDouble()
  securityHeaders({}, response, () => {})
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(response.headers['X-Frame-Options'], 'DENY')
  assert.equal(response.headers['Permissions-Policy'].includes('microphone=()'), true)
})

function responseDouble() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    on() {}
  }
}
