import * as assert from 'node:assert/strict'
import { formatLine, redactSecrets, shouldRotate } from '../../src/logging'

describe('formatLine', () => {
  it('puts the timestamp and level in front of the message', () => {
    assert.equal(
      formatLine('info', 'binary found', '2026-07-30T10:00:00.000Z'),
      '2026-07-30T10:00:00.000Z [INFO] binary found',
    )
  })

  it('keeps a multi-line message on one entry by indenting the rest', () => {
    const line = formatLine('error', 'failed\nbecause', '2026-07-30T10:00:00.000Z')
    assert.equal(line, '2026-07-30T10:00:00.000Z [ERROR] failed\n    because')
  })
})

describe('shouldRotate', () => {
  it('rotates once the write would exceed the cap', () => {
    assert.equal(shouldRotate(900, 200, 1000), true)
  })

  it('does not rotate when the write still fits', () => {
    assert.equal(shouldRotate(700, 200, 1000), false)
  })

  it('does not rotate an empty file even for an oversized write', () => {
    assert.equal(shouldRotate(0, 5000, 1000), false)
  })
})

describe('redactSecrets', () => {
  it('hides a token in a URL query', () => {
    assert.equal(
      redactSecrets('https://github.com/x?access_token=abc123'),
      'https://github.com/x?access_token=REDACTED',
    )
  })

  it('hides a bearer token', () => {
    assert.equal(redactSecrets('Authorization: Bearer abc.def'), 'Authorization: Bearer REDACTED')
  })

  it('leaves ordinary text alone', () => {
    assert.equal(redactSecrets('indexed 42 files'), 'indexed 42 files')
  })

  it('stops redaction at the next query parameter', () => {
    assert.equal(
      redactSecrets('https://x?access_token=abc&page=2'),
      'https://x?access_token=REDACTED&page=2',
    )
  })

  it('redacts api_key= spelling', () => {
    assert.equal(redactSecrets('api_key=abc123'), 'api_key=REDACTED')
  })

  it('redacts token= spelling', () => {
    assert.equal(redactSecrets('token=abc123'), 'token=REDACTED')
  })

  it('redacts a bearer token at end-of-string with no trailing whitespace', () => {
    assert.equal(redactSecrets('Bearer abc.def'), 'Bearer REDACTED')
  })

  it('is case-insensitive for both patterns', () => {
    assert.equal(redactSecrets('ACCESS_TOKEN=abc123'), 'ACCESS_TOKEN=REDACTED')
    assert.equal(redactSecrets('bearer abc.def'), 'bearer REDACTED')
  })
})
