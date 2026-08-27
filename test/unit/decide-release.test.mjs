import * as assert from 'node:assert/strict'
import { decide } from '../../scripts/decide-release.mjs'

describe('decide', () => {
  it('releases a version above the newest tag', () => {
    assert.deepEqual(decide('1.2.0', ['v1.1.3', 'v1.1.2']), {
      release: true,
      tag: 'v1.2.0',
      reason: 'releasing v1.2.0, above v1.1.3',
    })
  })

  it('does nothing when the version is already tagged', () => {
    const decision = decide('1.1.3', ['v1.1.2', 'v1.1.3'])
    assert.equal(decision.release, false)
    assert.equal(decision.tag, undefined)
  })

  it('refuses a version that is not above the newest tag', () => {
    assert.throws(() => decide('1.1.2', ['v1.1.3']), /not above the newest tag v1\.1\.3/)
  })

  it('refuses a repository with no version tag', () => {
    assert.throws(() => decide('1.2.0', ['nightly']), /no v\* tag found/)
  })
})
