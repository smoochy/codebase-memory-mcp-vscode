import * as assert from 'node:assert/strict'
import {
  ALLOWED_HOSTS,
  BINARY_BASE,
  INSTALL_COMMAND,
  UNINSTALL_COMMAND,
  UPSTREAM,
  installCommandFor,
  installCommandForBash,
  uninstallCommandFor,
} from '../../src/constants'

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
    it('quotes the path, which is why a space must stay acceptable', () => {
      assert.equal(
        uninstallCommandFor('/opt/Program Files/cmm', 'linux'),
        '"/opt/Program Files/cmm" uninstall',
      )
    })

    it('keeps backslashes, since every Windows path has them', () => {
      assert.equal(
        uninstallCommandFor('C:\\Users\\me\\cmm.exe', 'win32'),
        '& "C:\\Users\\me\\cmm.exe" uninstall',
      )
    })

    // A quoted string in command position is a parse error in PowerShell,
    // which is the default terminal on Windows.
    it('prefixes the call operator on Windows only', () => {
      assert.ok(uninstallCommandFor('C:/a/cmm.exe', 'win32').startsWith('& "'))
      assert.ok(uninstallCommandFor('/usr/bin/cmm', 'darwin').startsWith('"'))
    })

    // The string is handed to the user to paste into a shell, so a path that
    // could close the quote must never reach the clipboard.
    for (const [label, hostile] of [
      ['a double quote', '/tmp/a"; id; "b'],
      ['a command substitution', '/tmp/$(id)'],
      ['a backtick', '/tmp/`id`'],
      ['a newline', '/tmp/a\nid'],
      ['a carriage return', '/tmp/a\rid'],
    ] as const) {
      it(`refuses ${label} and falls back to the bare command`, () => {
        assert.equal(uninstallCommandFor(hostile, 'linux'), UNINSTALL_COMMAND)
        assert.equal(uninstallCommandFor(hostile, 'win32'), UNINSTALL_COMMAND)
      })
    }

    it('falls back when no binary resolved at all', () => {
      assert.equal(uninstallCommandFor(null, 'linux'), UNINSTALL_COMMAND)
    })
  })

  // The button exists for an install the extension does not own, which is the
  // one it can least assume is on PATH.
  describe('installCommandFor', () => {
    it('binds the register command to the resolved binary', () => {
      assert.equal(installCommandFor('C:\\Users\\me\\cmm.exe', 'win32'), '& "C:\\Users\\me\\cmm.exe" install')
      assert.equal(installCommandFor('/opt/Program Files/cmm', 'linux'), '"/opt/Program Files/cmm" install')
      assert.equal(installCommandForBash('C:\\Users\\me\\cmm.exe'), '"C:/Users/me/cmm.exe" install')
    })

    it('falls back to the bare command for a path that could close the quote', () => {
      assert.equal(installCommandFor('/tmp/a"; id; "b', 'linux'), INSTALL_COMMAND)
      assert.equal(installCommandForBash('/tmp/$(id)'), INSTALL_COMMAND)
      assert.equal(installCommandFor(null, 'win32'), INSTALL_COMMAND)
    })
  })
})
