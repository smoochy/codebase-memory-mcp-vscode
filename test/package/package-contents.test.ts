import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PANEL_CSS, renderBody } from '../../src/panel/html'

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

  // The check above named three directories and therefore missed the fourth
  // the moment it appeared: scripts/ shipped inside the installed extension
  // until vsce ls was actually read.
  it('excludes developer tooling', () => {
    assert.ok(!files.some((f) => f.startsWith('scripts/')), `packaged: ${files.join(', ')}`)
  })

  it('ships only the runtime bundle, the manifest and documentation', () => {
    // Anything outside these is either a mistake or wants a deliberate rule.
    const allowed = /^(dist\/|media\/|package\.json$|readme\.md$|changelog\.md$|security\.md$|LICENSE|docs\/)/i
    const unexpected = files.filter((f) => !allowed.test(f))
    assert.deepEqual(unexpected, [], 'unexpected files in the package')
  })

  // A marketplace version is irreversible, so a listing published without its
  // icon cannot be corrected under the same version.
  it('ships the listing icon and not its vector source', () => {
    assert.ok(files.includes('media/icon.png'))
    assert.ok(!files.includes('media/icon-marketplace.svg'))
  })

  it('ships no binary, since the extension downloads it at runtime', () => {
    assert.ok(!files.some((f) => /codebase-memory-mcp(\.exe)?$/.test(f)))
  })

  // A packaged extension runs dist/extension.js, never src/. Every unit test
  // in this repo imports the TypeScript directly, so a stale bundle passes all
  // of them and still ships the previous UI - which is exactly what happened:
  // vsce packaged a dist/ built before the panel rewrite, and the installed
  // extension showed the old panel while every test was green.
  describe('bundle freshness', () => {
    const bundle = readFileSync(
      resolve(__dirname, '../../../dist/extension.js'),
      'utf8',
    )

    it('contains the stylesheet the current source renders', () => {
      // Class names survive minification (they live inside string literals),
      // so sampling distinctive selectors detects a bundle built from older
      // source without depending on the exact CSS text.
      for (const selector of ['metric-value', '--tint', 'vscode-light']) {
        assert.ok(
          bundle.includes(selector),
          `dist/extension.js is stale: no "${selector}" - run npm run build`,
        )
      }
      assert.ok(PANEL_CSS.includes('metric-value'))
    })

    it('contains the markup the current source renders', () => {
      const html = renderBody(
        {
          state: {
            kind: 'ready-managed',
            activePath: '/bin/codebase-memory-mcp',
            effectiveSource: 'managed',
            notice: null,
            pathConflict: null,
            foreignPlatformEntry: null,
          },
          projects: [],
          version: null,
          updateAvailable: null,
        },
        'n1',
      )
      // Structural markers the rewrite introduced. If the bundle predates it,
      // the panel renders the old flat button list instead.
      for (const marker of ['brand-sub', 'metric-label', 'metrics']) {
        assert.ok(html.includes(marker), `renderBody lost "${marker}"`)
        assert.ok(
          bundle.includes(marker),
          `dist/extension.js is stale: no "${marker}" - run npm run build`,
        )
      }
    })
  })
})
