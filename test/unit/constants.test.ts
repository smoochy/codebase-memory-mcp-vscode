import * as assert from 'node:assert/strict'
import { ALLOWED_HOSTS, BINARY_BASE, UNINSTALL_COMMAND, UPSTREAM, uninstallCommandFor } from '../../src/constants'

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

  describe('uninstallCommandFor', () => {
    it('binds the command to an absolute path, quoted for spaces', () => {
      assert.equal(
        uninstallCommandFor('C:/Program Files/cmm.exe'),
        '"C:/Program Files/cmm.exe" uninstall',
      )
    })

    // Only reachable when no binary resolved at all; the bare name is the best
    // guess left, and it is what the user would type themselves.
    it('falls back to the bare command with no path', () => {
      assert.equal(uninstallCommandFor(null), UNINSTALL_COMMAND)
    })
  })
})
