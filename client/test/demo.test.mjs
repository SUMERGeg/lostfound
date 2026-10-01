import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

let demo = {}
try {
  demo = await import('../src/demo.js')
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
}

function request(path, options) {
  assert.equal(typeof demo.demoRequest, 'function', 'Demo requests must work without a backend')
  return demo.demoRequest(path, options)
}

test('demo feed supplies readable listings and bundled images without a backend', async () => {
  const response = await request('/api/v1/ads?limit=100')
  assert.equal(response.status, 200)
  const items = await response.json()
  assert.equal(items.length, 5)
  assert.ok(items.some(item => item.type === 'LOST'))
  assert.ok(items.some(item => item.type === 'FOUND'))
  for (const item of items) {
    assert.ok(item.title && item.description)
    assert.ok(Number.isFinite(item.lat) && Number.isFinite(item.lng))
    assert.ok(item.photos.length > 0)
    for (const photo of item.photos) {
      assert.ok(photo.startsWith('/sample/'))
      assert.ok(existsSync(new URL(`../public${photo}`, import.meta.url)))
    }
    assert.equal(item.phone, undefined)
    assert.equal(item.email, undefined)
  }
})

test('type and category filters intersect rather than returning the entire feed', async () => {
  const items = await (await request('/api/v1/ads?type=FOUND&category=wear')).json()
  assert.deepEqual(items.map(item => item.id), ['demo-backpack-found'])
  const empty = await (await request('/api/v1/ads?type=LOST&category=keys')).json()
  assert.deepEqual(empty, [])
  assert.equal((await (await request('/api/v1/ads?limit=2')).json()).length, 2)
})

test('listing links return details for the selected item and 404 for unknown ids', async () => {
  const response = await request('/api/v1/ads/demo-phone')
  assert.equal(response.status, 200)
  const item = await response.json()
  assert.equal(item.category, 'electronics')
  assert.equal(item.type, 'FOUND')
  assert.equal((await request('/api/v1/ads/missing')).status, 404)
})

test('all mutation methods are refused and cannot change the demonstration feed', async () => {
  const before = await (await request('/api/v1/ads')).text()
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
    for (const path of ['/api/v1/ads', '/api/v1/auth/register', '/api/v1/uploads', '/api/v1/privacy-requests']) {
      assert.equal((await request(path, { method, body: '{}' })).status, 403)
    }
  }
  assert.equal(await (await request('/api/v1/ads')).text(), before)
})

test('unknown reads never expose admin data or fall back to a network API', async () => {
  assert.equal((await request('/api/v1/admin/users')).status, 404)
  assert.equal((await request('/api/v1/profile')).status, 404)
})

test('canceled demo requests honor the same AbortSignal contract as fetch', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => request('/api/v1/ads', { signal: controller.signal }), { name: 'AbortError' })
})

test('changing parsed response data cannot persist new or edited advertisements', async () => {
  const items = await (await request('/api/v1/ads')).json()
  items[0].title = 'Changed by a visitor'
  items[0].photos.push('/fake.png')
  const again = await (await request(`/api/v1/ads/${items[0].id}`)).json()
  assert.notEqual(again.title, 'Changed by a visitor')
  assert.ok(!again.photos.includes('/fake.png'))
})

test('demo navigation allows viewing but blocks forms and direct mutation-page links', () => {
  assert.equal(typeof demo.isDemoPath, 'function', 'Demo needs a route guard')
  for (const path of ['/', '/ads', '/ads/', '/map', '/ads/demo-phone', '/listing/demo-phone', '/privacy', '/terms', '/personal-data-consent', '/publication-rules']) {
    assert.equal(demo.isDemoPath(path), true, path)
  }
  for (const path of ['/login', '/register', '/create/lost', '/profile', '/admin', '/privacy-request', '/ads/demo-phone/edit', '/ads/demo-phone/claim', '/ads/demo-phone/report', '/reset-password', '/matches', '/unknown']) {
    assert.equal(demo.isDemoPath(path), false, path)
  }
})
