import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

/** `vsce ls` prints the files that would be packaged. */
function packagedFiles(): string[] {
  // shell: true so Windows resolves npx.cmd (execFileSync otherwise looks for a
  // literal `npx` executable and fails with ENOENT). Args are fixed literals
  // below, not interpolated input, so shell concatenation is not a risk here.
  const output = execFileSync('npx', ['--no-install', 'vsce', 'ls'], {
    encoding: 'utf8',
    shell: true,
  })
  return output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
}

describe('packaged contents', () => {
  const files = packagedFiles()

  it('includes the bundled entry point and the licence', () => {
    assert.ok(files.includes('dist/extension.js'))
    assert.ok(files.includes('LICENSE'))
  })

  it('excludes sources, tests and node_modules', () => {
    assert.ok(!files.some((f) => f.startsWith('src/')))
    assert.ok(!files.some((f) => f.startsWith('test/')))
    assert.ok(!files.some((f) => f.startsWith('node_modules/')))
  })

  it('ships no binary, since the extension downloads it at runtime', () => {
    assert.ok(!files.some((f) => /codebase-memory-mcp(\.exe)?$/.test(f)))
  })
})
