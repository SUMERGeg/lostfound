import assert from 'node:assert/strict'
import test from 'node:test'

import { loadRuntimeConfig } from '../src/config.js'

const JWT_ACCESS_SECRET = 'test-only-access-secret-with-more-than-32-bytes'
const EMAIL_TOKEN_SECRET = 'different-test-email-secret-with-more-than-32-bytes'

test('requires sufficiently long independent signing secrets', () => {
  assert.throws(() => loadRuntimeConfig({ JWT_ACCESS_SECRET: 'short', EMAIL_TOKEN_SECRET }), /JWT_ACCESS_SECRET/)
  assert.throws(() => loadRuntimeConfig({ JWT_ACCESS_SECRET, EMAIL_TOKEN_SECRET: 'short' }), /EMAIL_TOKEN_SECRET/)
})

test('does not allow localhost through production CORS', () => {
  const config = loadRuntimeConfig({
    NODE_ENV: 'production',
    FRONT_ORIGIN: 'https://lostfound.example',
    JWT_ACCESS_SECRET,
    EMAIL_TOKEN_SECRET,
    EMAIL_API_URL: 'https://email.example/send',
    EMAIL_API_TOKEN: 'test-token',
    EMAIL_FROM: 'no-reply@example.com'
  })
  assert.deepEqual(config.allowedOrigins, ['https://lostfound.example'])
})
