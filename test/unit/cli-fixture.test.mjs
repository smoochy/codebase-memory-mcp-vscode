import * as assert from 'node:assert/strict'
import {
  binaryFileName,
  cacheRoot,
  classifyAcquisitionError,
  fixtureInstallPath,
  pinKey,
  readPin,
  resolvePin,
} from '../../scripts/cli-fixture.mjs'

const pin = readPin()

describe('cli-pin.json', () => {
  it('pins both entries the fixture rows need', () => {
    assert.deepEqual(Object.keys(pin.entries).sort(), ['current', 'old'])
    assert.equal(pin.entries.current.tag, 'v0.10.8')
    assert.equal(pin.entries.old.tag, 'v0.10.0')
  })

  it('covers every platform a run can execute on', () => {
    const wanted = [
      'win32-x64',
      'win32-arm64',
      'darwin-x64',
      'darwin-arm64',
      'linux-x64',
      'linux-arm64',
    ]
    for (const entry of Object.values(pin.entries)) {
      assert.deepEqual(Object.keys(entry.assets).sort(), [...wanted].sort())
    }
  })

  it('names Windows .zip and .tar.gz elsewhere, matching the extension assets', () => {
    for (const entry of Object.values(pin.entries)) {
      for (const [key, asset] of Object.entries(entry.assets)) {
        const suffix = key.startsWith('win32-') ? '.zip' : '.tar.gz'
        assert.ok(asset.asset.endsWith(suffix), `${key}: ${asset.asset}`)
        assert.match(asset.sha256, /^[0-9a-f]{64}$/u)
      }
    }
  })

  it('pins the two tags to different bytes, or the old entry proves nothing', () => {
    for (const key of Object.keys(pin.entries.current.assets)) {
      assert.notEqual(pin.entries.current.assets[key].sha256, pin.entries.old.assets[key].sha256)
    }
  })
})

describe('resolvePin', () => {
  it('returns the tag, asset and digest for one platform', () => {
    const resolved = resolvePin(pin, 'current', 'win32', 'x64')
    assert.equal(resolved.tag, 'v0.10.8')
    assert.equal(resolved.asset, 'codebase-memory-mcp-windows-amd64.zip')
    assert.equal(resolved.sha256.length, 64)
  })

  it('refuses an unknown entry rather than falling back', () => {
    assert.throws(() => resolvePin(pin, 'latest', 'linux', 'x64'), /no such pin entry/u)
  })

  it('refuses an unlisted architecture rather than testing a different build', () => {
    assert.throws(() => resolvePin(pin, 'current', 'linux', 'ppc64'), /lists no asset/u)
  })

  it('refuses a malformed digest', () => {
    const broken = { entries: { current: { tag: 'v1', assets: { 'linux-x64': { asset: 'a', sha256: 'nope' } } } } }
    assert.throws(() => resolvePin(broken, 'current', 'linux', 'x64'), /malformed sha256/u)
  })
})

describe('classifyAcquisitionError', () => {
  it('keeps a checksum mismatch apart from a network failure', () => {
    assert.equal(
      classifyAcquisitionError(new Error('checksum mismatch for x: expected a, got b')),
      'checksum',
    )
    assert.equal(classifyAcquisitionError(new Error('no checksum published for x')), 'checksum')
    assert.equal(classifyAcquisitionError(new Error('fetch failed')), 'network')
    assert.equal(classifyAcquisitionError(new Error('getaddrinfo ENOTFOUND github.com')), 'network')
  })

  it('reports a broken pin as neither', () => {
    assert.equal(classifyAcquisitionError(new Error('no such pin entry: latest')), 'pin')
  })
})

describe('cacheRoot', () => {
  it('stays outside the checkout on both operating systems', () => {
    assert.equal(
      cacheRoot({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'win32').replace(/\\/gu, '/'),
      'C:/Users/x/AppData/Local/cmm-autotest',
    )
    assert.equal(
      cacheRoot({ HOME: '/home/x' }, 'linux').replace(/\\/gu, '/'),
      '/home/x/.cache/cmm-autotest',
    )
  })

  it('refuses to guess when the variable it needs is unset', () => {
    assert.throws(() => cacheRoot({}, 'win32'), /LOCALAPPDATA/u)
    assert.throws(() => cacheRoot({}, 'darwin'), /HOME/u)
  })
})

describe('fixtureInstallPath', () => {
  // This has to stay the first entry of externalCandidates() in
  // src/binary/locate.ts, or the fixture rows exercise the weakest detection
  // path instead of the one they are about.
  it('is <scratchHome>/.local/bin/<binary>', () => {
    assert.equal(
      fixtureInstallPath('/tmp/h', 'darwin').replace(/\\/gu, '/'),
      '/tmp/h/.local/bin/codebase-memory-mcp',
    )
    assert.equal(
      fixtureInstallPath('/tmp/h', 'win32').replace(/\\/gu, '/'),
      '/tmp/h/.local/bin/codebase-memory-mcp.exe',
    )
  })

  it('names the binary as the extension does', () => {
    assert.equal(binaryFileName('win32'), 'codebase-memory-mcp.exe')
    assert.equal(binaryFileName('linux'), 'codebase-memory-mcp')
  })

  it('keys the pin by node platform and architecture', () => {
    assert.equal(pinKey('darwin', 'arm64'), 'darwin-arm64')
  })
})
