import * as assert from 'node:assert/strict'
import { ALLOWED_HOSTS, BINARY_BASE, UPSTREAM } from '../../src/constants'

describe('constants', () => {
  it('points at the upstream repository', () => {
    assert.equal(UPSTREAM.owner, 'DeusData')
    assert.equal(UPSTREAM.repo, 'codebase-memory-mcp')
    assert.equal(BINARY_BASE, 'codebase-memory-mcp')
  })

  it('lists allowed hosts in lowercase without wildcards', () => {
    assert.ok(ALLOWED_HOSTS.length > 0)
    for (const host of ALLOWED_HOSTS) {
      assert.equal(host, host.toLowerCase())
      assert.ok(!host.includes('*'), `${host} must not be a wildcard`)
    }
  })
})
