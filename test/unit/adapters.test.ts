import * as assert from 'node:assert/strict'
import { MAX_CAPTURED_OUTPUT, runProcess } from '../../src/adapters'

/** Runs the current node binary, so the tests need nothing installed. */
const NODE = process.execPath

describe('runProcess', () => {
  it('captures stdout and the exit code', async () => {
    const result = await runProcess(NODE, ['-e', 'process.stdout.write("hello")'], 20_000)
    assert.equal(result.stdout, 'hello')
    assert.equal(result.code, 0)
  })

  it('captures stderr and a non-zero exit code', async () => {
    const result = await runProcess(
      NODE,
      ['-e', 'process.stderr.write("boom"); process.exit(3)'],
      20_000,
    )
    assert.equal(result.stderr, 'boom')
    assert.equal(result.code, 3)
  })

  // A runaway child that writes without bound would otherwise grow the
  // extension host's heap until it dies. The cap turns that into truncation.
  it('caps stdout instead of buffering without limit', async () => {
    const chunk = 'x'.repeat(1024 * 1024)
    const script =
      `const c = "${'x'.repeat(64)}".repeat(${String(1024 * 1024 / 64)});` +
      'for (let i = 0; i < 32; i++) process.stdout.write(c)'
    const result = await runProcess(NODE, ['-e', script], 60_000)
    assert.ok(
      result.stdout.length <= MAX_CAPTURED_OUTPUT + chunk.length,
      `stdout grew to ${String(result.stdout.length)} bytes`,
    )
    assert.ok(result.stdout.length >= MAX_CAPTURED_OUTPUT)
  })

  it('caps stderr the same way', async () => {
    const script =
      `const c = "${'y'.repeat(64)}".repeat(${String(1024 * 1024 / 64)});` +
      'for (let i = 0; i < 32; i++) process.stderr.write(c)'
    const result = await runProcess(NODE, ['-e', script], 60_000)
    assert.ok(result.stderr.length <= MAX_CAPTURED_OUTPUT + 1024 * 1024)
    assert.ok(result.stderr.length >= MAX_CAPTURED_OUTPUT)
  })

  // The wrapped binary is an MCP server that reads stdin. With stdin left as
  // an open pipe it waits for input that never arrives, so every call ran into
  // its timeout and returned nothing - measured against the real binary as a
  // hang with 0 bytes, versus 210 ms and a full payload once stdin was closed.
  it('closes stdin, so a child that waits on it still finishes', async () => {
    const result = await runProcess(
      NODE,
      ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("eof"))'],
      5_000,
    )
    assert.equal(result.stdout, 'eof')
    assert.equal(result.code, 0)
  })

  it('rejects when the child outlives the timeout', async () => {
    await assert.rejects(
      runProcess(NODE, ['-e', 'setTimeout(() => {}, 30000)'], 300),
      /timed out after 300 ms/,
    )
  })

  it('rejects when the command does not exist', async () => {
    await assert.rejects(runProcess('definitely-not-a-real-binary-xyz', [], 20_000))
  })
})
