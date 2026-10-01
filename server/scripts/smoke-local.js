import assert from 'node:assert/strict'

const API_BASE = (process.env.SMOKE_API_BASE ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const DEMO_PASSWORD = process.env.SMOKE_DEMO_PASSWORD ?? 'DemoPassword!2026'

async function request(path, { token, expectedStatus = 200, ...options } = {}) {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  assert.equal(
    response.status,
    expectedStatus,
    `${options.method ?? 'GET'} ${path}: expected ${expectedStatus}, received ${response.status} (${text})`
  )
  return body
}

async function login(email) {
  return request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: DEMO_PASSWORD })
  })
}

async function run() {
  const ready = await request('/health/ready')
  assert.equal(ready.ok, true)

  const ads = await request('/api/v1/ads?limit=20')
  const listings = ads.items ?? ads
  assert.ok(Array.isArray(listings) && listings.length >= 5, 'Seed must expose at least five demo listings')

  const userSession = await login('anton@example.test')
  assert.equal(userSession.user.role, 'USER')
  assert.equal(userSession.user.emailVerified, true, 'Demo user must have a verified email')

  const profile = await request('/api/v1/profile', { token: userSession.accessToken })
  assert.equal(profile.email, 'anton@example.test')

  const matches = await request('/api/v1/matches', { token: userSession.accessToken })
  assert.ok(matches.length >= 1, 'Seed must create at least one match for the demo user')
  assert.equal(matches[0].algorithmVersion, 'baseline-v1')

  await request('/api/v1/admin/users', {
    token: userSession.accessToken,
    expectedStatus: 403
  })

  const privacyReceipt = await request('/api/v1/privacy-requests', {
    token: userSession.accessToken,
    method: 'POST',
    expectedStatus: 201,
    body: JSON.stringify({
      email: 'ignored-spoof@example.test',
      requestType: 'ACCESS',
      message: 'Production rehearsal request for a copy of account data.'
    })
  })
  assert.deepEqual(Object.keys(privacyReceipt).sort(), ['id', 'status'])
  assert.equal(privacyReceipt.status, 'NEW')

  const adminSession = await login('admin@example.test')
  assert.equal(adminSession.user.role, 'ADMIN')
  const users = await request('/api/v1/admin/users', { token: adminSession.accessToken })
  assert.ok(users.some(user => user.email === 'anton@example.test'))

  const privacyQueue = await request('/api/v1/admin/privacy-requests', { token: adminSession.accessToken })
  const privacyRequest = privacyQueue.find(item => item.id === privacyReceipt.id)
  assert.ok(privacyRequest, 'Privacy request must appear in the administrative queue')
  assert.equal(privacyRequest.email, 'anton@example.test', 'Authenticated request must use the account email')
  assert.equal(privacyRequest.status, 'NEW')
  await request(`/api/v1/admin/privacy-requests/${privacyReceipt.id}`, {
    token: adminSession.accessToken,
    method: 'PATCH',
    body: JSON.stringify({ status: 'RESOLVED' })
  })

  console.log('Local smoke passed: readiness, public feed, auth, matching, privacy requests and admin RBAC are operational.')
}

run().catch(error => {
  console.error('Local smoke failed:', error.message)
  process.exitCode = 1
})
