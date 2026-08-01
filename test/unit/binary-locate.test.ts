import * as assert from 'node:assert/strict'
import {
  externalCandidates,
  findFirstExisting,
  managedBinaryPath,
  type LocateEnv,
} from '../../src/binary/locate'

const windows: LocateEnv = {
  platform: 'win32',
  home: 'C:/Users/x',
  pathVar: 'C:/tools;C:/other',
  pathSeparator: ';',
}

const linux: LocateEnv = {
  platform: 'linux',
  home: '/home/x',
  pathVar: '/usr/bin:/usr/local/bin',
  pathSeparator: ':',
}

describe('externalCandidates', () => {
  it('puts the user local bin directory first on Windows', () => {
    const candidates = externalCandidates(windows)
    assert.equal(candidates[0], 'C:/Users/x/.local/bin/codebase-memory-mcp.exe')
  })

  it('appends the exe suffix on Windows only', () => {
    assert.ok(externalCandidates(windows).every((c) => c.endsWith('.exe')))
    assert.ok(externalCandidates(linux).every((c) => !c.endsWith('.exe')))
  })

  it('includes the homebrew location on macOS', () => {
    const candidates = externalCandidates({ ...linux, platform: 'darwin' })
    assert.ok(candidates.includes('/opt/homebrew/bin/codebase-memory-mcp'))
  })

  it('scans PATH entries after the well known locations', () => {
    const candidates = externalCandidates(linux)
    const fromPath = candidates.indexOf('/usr/bin/codebase-memory-mcp')
    const wellKnown = candidates.indexOf('/home/x/.local/bin/codebase-memory-mcp')
    assert.ok(fromPath > wellKnown, 'PATH entries must come last')
  })

  it('tolerates an empty PATH', () => {
    const candidates = externalCandidates({ ...linux, pathVar: '' })
    assert.ok(candidates.length > 0)
    assert.ok(candidates.every((c) => c.length > 0))
  })

  it('lists no duplicates', () => {
    const candidates = externalCandidates({ ...linux, pathVar: '/home/x/.local/bin' })
    assert.equal(new Set(candidates).size, candidates.length)
  })

  it('drops relative PATH entries on a posix env', () => {
    const candidates = externalCandidates({ ...linux, pathVar: '.:bin:/usr/bin' })
    assert.ok(!candidates.some((c) => c === './codebase-memory-mcp'))
    assert.ok(!candidates.some((c) => c === 'bin/codebase-memory-mcp'))
  })

  it('drops relative PATH entries on a win32 env', () => {
    const candidates = externalCandidates({ ...windows, pathVar: '.;bin;C:\\tools' })
    assert.ok(!candidates.some((c) => c === './codebase-memory-mcp.exe'))
    assert.ok(!candidates.some((c) => c === 'bin/codebase-memory-mcp.exe'))
  })

  it('still resolves absolute PATH entries alongside dropped relative ones', () => {
    const posix = externalCandidates({ ...linux, pathVar: '.:/usr/bin' })
    assert.ok(posix.includes('/usr/bin/codebase-memory-mcp'))

    const win = externalCandidates({ ...windows, pathVar: 'bin;C:\\tools' })
    assert.ok(win.includes('C:/tools/codebase-memory-mcp.exe'))
  })
})

describe('managedBinaryPath', () => {
  // On PATH, not in extension storage: the CLI's own `install` registers this
  // exact path as the MCP server command, so a binary kept anywhere else
  // leaves that entry pointing at a file that is not there.
  it('lives on PATH, where the MCP entry will point', () => {
    assert.equal(
      managedBinaryPath('C:/Users/me', 'win32'),
      'C:/Users/me/.local/bin/codebase-memory-mcp.exe',
    )
    assert.equal(managedBinaryPath('/home/me', 'linux'), '/home/me/.local/bin/codebase-memory-mcp')
  })

  it('normalises a Windows home with backslashes', () => {
    assert.equal(
      managedBinaryPath('C:\\Users\\me', 'win32'),
      'C:/Users/me/.local/bin/codebase-memory-mcp.exe',
    )
  })

  // The same path the external search looks at first, which is why the caller
  // has to exclude it before deciding a user installation exists.
  it('matches the first external candidate, by design', () => {
    const candidates = externalCandidates({
      platform: 'linux',
      home: '/home/me',
      pathVar: '',
      pathSeparator: ':',
    })
    assert.equal(candidates[0], managedBinaryPath('/home/me', 'linux'))
  })
})

describe('findFirstExisting', () => {
  it('returns the first candidate that exists', () => {
    const found = findFirstExisting(['/a', '/b', '/c'], (p) => p === '/b' || p === '/c')
    assert.equal(found, '/b')
  })

  it('returns null when nothing exists', () => {
    assert.equal(findFirstExisting(['/a'], () => false), null)
  })

  it('ignores a candidate whose check throws, for example a permission error', () => {
    const found = findFirstExisting(['/denied', '/ok'], (p) => {
      if (p === '/denied') {
        throw new Error('EACCES')
      }
      return true
    })
    assert.equal(found, '/ok')
  })
})
