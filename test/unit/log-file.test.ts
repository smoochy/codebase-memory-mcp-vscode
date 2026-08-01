import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogFile } from '../../src/log-file'

/** A fresh directory per test, so rotation state never leaks between them. */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'better-cmm-log-'))
}

const AT = '2026-08-01T10:00:00.000Z'

describe('LogFile', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function make(maxBytes = 1024, keep = 3): LogFile {
    const dir = scratch()
    dirs.push(dir)
    return new LogFile(dir, 'test.log', maxBytes, keep)
  }

  it('writes a formatted line', () => {
    const log = make()
    log.append('info', 'hello', AT)
    assert.equal(readFileSync(log.path, 'utf8'), `${AT} [INFO] hello\n`)
  })

  it('creates the directory when it does not exist yet', () => {
    const dir = scratch()
    dirs.push(dir)
    const log = new LogFile(join(dir, 'nested', 'deeper'), 'test.log')
    log.append('info', 'hello', AT)
    assert.ok(existsSync(log.path))
  })

  it('appends rather than replacing', () => {
    const log = make()
    log.append('info', 'first', AT)
    log.append('warn', 'second', AT)
    const lines = readFileSync(log.path, 'utf8').trimEnd().split('\n')
    assert.equal(lines.length, 2)
    assert.match(lines[1]!, /\[WARN\] second/)
  })

  it('rotates once the cap is passed, keeping the old content in .1', () => {
    const log = make(120)
    log.append('info', 'x'.repeat(100), AT)
    log.append('info', 'after rotation', AT)
    assert.match(readFileSync(`${log.path}.1`, 'utf8'), /x{100}/)
    assert.match(readFileSync(log.path, 'utf8'), /after rotation/)
    assert.doesNotMatch(readFileSync(log.path, 'utf8'), /x{100}/)
  })

  it('keeps only the configured number of generations', () => {
    const log = make(60, 2)
    for (let i = 0; i < 6; i += 1) {
      log.append('info', `entry ${String(i)} ${'y'.repeat(40)}`, AT)
    }
    assert.ok(existsSync(`${log.path}.1`))
    assert.ok(existsSync(`${log.path}.2`))
    assert.ok(!existsSync(`${log.path}.3`), 'kept more generations than configured')
  })

  it('never throws when the path cannot be written', () => {
    // The directory name is a file, so every write below fails. Logging must
    // not be the reason an operation fails.
    const dir = scratch()
    dirs.push(dir)
    const blocker = new LogFile(dir, 'blocker.log')
    blocker.append('info', 'creates the file', AT)
    const log = new LogFile(blocker.path, 'inside-a-file.log')
    assert.doesNotThrow(() => {
      log.append('error', 'this cannot land anywhere', AT)
    })
  })
})
