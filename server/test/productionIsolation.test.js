import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('production composition root has no MAX or volunteer runtime dependency', async () => {
  const [source, manifest] = await Promise.all([
    readFile(new URL('../src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse)
  ])
  assert.equal(source.includes("'./max.js'"), false)
  assert.equal(source.includes("'./webhook.js'"), false)
  assert.equal(source.includes('/webhook'), false)
  assert.equal(Object.hasOwn(manifest.dependencies, '@maxhub/max-bot-api'), false)
})
