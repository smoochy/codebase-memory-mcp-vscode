import * as assert from 'node:assert/strict'
import {
  assertAllowedUrl,
  expectedChecksum,
  parseChecksums,
  sha256,
} from '../../src/binary/verify'

const CHECKSUMS = [
  '6af3d02a27f589901fa763d3971089337bc8c9838bbed5d0cf543ca9f1a9e543  codebase-memory-mcp-darwin-amd64.tar.gz',
  'faa02f0404230c451a9812230394481948f80183801fa5bf67044b41c2f25ed4  codebase-memory-mcp-darwin-arm64.tar.gz',
  'e2832a8d207c26beaa30efa6222ed4a37cb3f526ca4bee060bfbf336ed6fc679  codebase-memory-mcp-linux-amd64.tar.gz',
].join('\n')

describe('assertAllowedUrl', () => {
  it('accepts the release hosts', () => {
    assert.equal(
      assertAllowedUrl('https://github.com/DeusData/codebase-memory-mcp/releases/latest').hostname,
      'github.com',
    )
    assert.equal(
      assertAllowedUrl('https://objects.githubusercontent.com/x').hostname,
      'objects.githubusercontent.com',
    )
  })

  it('rejects a lookalike host rather than matching by suffix', () => {
    assert.throws(() => assertAllowedUrl('https://evil-github.com/x'), /host not allowed/i)
    assert.throws(() => assertAllowedUrl('https://github.com.evil.tld/x'), /host not allowed/i)
    assert.throws(() => assertAllowedUrl('https://notgithub.com/x'), /host not allowed/i)
  })

  it('rejects a subdomain of an allowed host', () => {
    assert.throws(() => assertAllowedUrl('https://x.github.com/y'), /host not allowed/i)
  })

  it('rejects plain HTTP even on an allowed host', () => {
    assert.throws(() => assertAllowedUrl('http://github.com/x'), /https/i)
  })

  it('rejects other schemes', () => {
    assert.throws(() => assertAllowedUrl('file:///etc/passwd'), /https/i)
    assert.throws(() => assertAllowedUrl('ftp://github.com/x'), /https/i)
  })

  it('compares the host case-insensitively', () => {
    assert.equal(assertAllowedUrl('https://GitHub.com/x').hostname, 'github.com')
  })

  it('rejects a malformed URL', () => {
    assert.throws(() => assertAllowedUrl('not a url'), /invalid url/i)
  })
})

describe('parseChecksums', () => {
  it('reads hash and file name pairs', () => {
    const map = parseChecksums(CHECKSUMS)
    assert.equal(map.size, 3)
    assert.equal(
      map.get('codebase-memory-mcp-linux-amd64.tar.gz'),
      'e2832a8d207c26beaa30efa6222ed4a37cb3f526ca4bee060bfbf336ed6fc679',
    )
  })

  it('ignores blank and malformed lines', () => {
    assert.equal(parseChecksums(CHECKSUMS + '\n\nnot a checksum line\n').size, 3)
  })
})

describe('expectedChecksum', () => {
  it('returns the hash for a known asset', () => {
    assert.equal(
      expectedChecksum(CHECKSUMS, 'codebase-memory-mcp-darwin-arm64.tar.gz'),
      'faa02f0404230c451a9812230394481948f80183801fa5bf67044b41c2f25ed4',
    )
  })

  it('throws when the asset has no line, never silently skipping verification', () => {
    assert.throws(
      () => expectedChecksum(CHECKSUMS, 'codebase-memory-mcp-windows-amd64.zip'),
      /no checksum/i,
    )
  })
})

describe('sha256', () => {
  it('matches the known digest of an empty input', () => {
    assert.equal(
      sha256(new Uint8Array()),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches the known digest of abc', () => {
    assert.equal(
      sha256(new TextEncoder().encode('abc')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
