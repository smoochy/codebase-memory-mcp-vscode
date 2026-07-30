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
})

describe('managedBinaryPath', () => {
  it('lives under the storage directory', () => {
    assert.equal(
      managedBinaryPath('C:/storage', 'win32'),
      'C:/storage/bin/codebase-memory-mcp.exe',
    )
    assert.equal(managedBinaryPath('/storage', 'linux'), '/storage/bin/codebase-memory-mcp')
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
