import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeployment, assetUrl } from '../src/deployment.js'

test('Pages uses a read-only demo, hash routes and the repository base', () => {
  assert.deepEqual(getDeployment('pages'), { isDemo: true, useHashRouter: true, base: '/lostfound/' })
})

test('Vercel demo and ordinary builds retain root-based browser routes', () => {
  assert.deepEqual(getDeployment('demo'), { isDemo: true, useHashRouter: false, base: '/' })
  assert.deepEqual(getDeployment('production'), { isDemo: false, useHashRouter: false, base: '/' })
  assert.equal(getDeployment('production', 'true').isDemo, true)
})

test('public photos resolve below the deployment base without duplicate slashes', () => {
  assert.equal(assetUrl('/sample/pet-mona.png', '/lostfound/'), '/lostfound/sample/pet-mona.png')
  assert.equal(assetUrl('sample/keys-bmw.png', '/lostfound/'), '/lostfound/sample/keys-bmw.png')
  assert.equal(assetUrl('/sample/pet-mona.png', '/'), '/sample/pet-mona.png')
})
