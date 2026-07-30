import * as assert from 'node:assert/strict'
import {
  assetName,
  binaryFileName,
  checksumsUrl,
  compareVersions,
  downloadUrl,
  latestReleaseUrl,
  releaseNotesUrl,
  tagFromLocation,
} from '../../src/binary/assets'

describe('assetName', () => {
  it('uses .zip on Windows and .tar.gz elsewhere', () => {
    assert.equal(
      assetName({ platform: 'win32', arch: 'x64' }, 'standard'),
      'codebase-memory-mcp-windows-amd64.zip',
    )
    assert.equal(
      assetName({ platform: 'linux', arch: 'x64' }, 'standard'),
      'codebase-memory-mcp-linux-amd64.tar.gz',
    )
    assert.equal(
      assetName({ platform: 'darwin', arch: 'arm64' }, 'standard'),
      'codebase-memory-mcp-darwin-arm64.tar.gz',
    )
  })

  it('inserts -ui for the ui variant', () => {
    assert.equal(
      assetName({ platform: 'win32', arch: 'arm64' }, 'ui'),
      'codebase-memory-mcp-ui-windows-arm64.zip',
    )
    assert.equal(
      assetName({ platform: 'darwin', arch: 'x64' }, 'ui'),
      'codebase-memory-mcp-ui-darwin-amd64.tar.gz',
    )
  })

  it('rejects platforms with no published asset', () => {
    assert.throws(
      () => assetName({ platform: 'freebsd', arch: 'x64' }, 'standard'),
      /unsupported platform/i,
    )
    assert.throws(
      () => assetName({ platform: 'linux', arch: 'ia32' }, 'standard'),
      /unsupported architecture/i,
    )
  })
})

describe('urls', () => {
  it('builds the download URL from tag and asset', () => {
    assert.equal(
      downloadUrl('v0.9.0', 'codebase-memory-mcp-windows-amd64.zip'),
      'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.9.0/codebase-memory-mcp-windows-amd64.zip',
    )
  })

  it('builds the checksums URL for the same tag', () => {
    assert.equal(
      checksumsUrl('v0.9.0'),
      'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.9.0/checksums.txt',
    )
  })

  it('points at the redirecting latest URL', () => {
    assert.equal(
      latestReleaseUrl(),
      'https://github.com/DeusData/codebase-memory-mcp/releases/latest',
    )
  })

  it('derives the release notes URL from a bare version', () => {
    assert.equal(
      releaseNotesUrl('0.9.0'),
      'https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.9.0',
    )
  })

  it('rejects an asset name that would escape the URL path', () => {
    assert.throws(() => downloadUrl('v0.9.0', '../../evil'), /invalid asset name/i)
    assert.throws(() => downloadUrl('v0.9.0', 'a/b.zip'), /invalid asset name/i)
  })
})

describe('tagFromLocation', () => {
  it('reads the tag out of the redirect target', () => {
    assert.equal(
      tagFromLocation(
        'https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.9.0',
      ),
      'v0.9.0',
    )
  })

  it('returns null for an unrelated location', () => {
    assert.equal(tagFromLocation('https://github.com/login'), null)
    assert.equal(tagFromLocation(''), null)
  })
})

describe('compareVersions', () => {
  it('orders by numeric segment', () => {
    assert.ok(compareVersions('0.9.1', '0.9.0') > 0)
    assert.ok(compareVersions('0.9.0', '0.10.0') < 0)
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  })

  it('treats missing segments as zero', () => {
    assert.equal(compareVersions('0.9', '0.9.0'), 0)
    assert.ok(compareVersions('0.9.1', '0.9') > 0)
  })

  it('ignores a leading v', () => {
    assert.equal(compareVersions('v0.9.0', '0.9.0'), 0)
  })
})

describe('binaryFileName', () => {
  it('appends .exe only on Windows', () => {
    assert.equal(binaryFileName('win32'), 'codebase-memory-mcp.exe')
    assert.equal(binaryFileName('linux'), 'codebase-memory-mcp')
  })
})
