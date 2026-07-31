import * as assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * Where the captured markup lands, so the panel's real output can be read
 * after the run instead of inferred from a preview harness.
 *
 * Rendering the panel outside VS Code proved worthless: the preview imported
 * the TypeScript directly and passed while the packaged extension shipped a
 * bundle built before the rewrite. Only the running extension host tells the
 * truth about what a user sees.
 */
const DUMP_FILE = resolve(__dirname, '../../../.vscode-test/panel-render.html')

describe('panel renders in a real extension host', () => {
  let html = ''

  before(async function () {
    this.timeout(60_000)
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate()

    // Focusing the view is what makes VS Code resolve the provider; without
    // it resolveWebviewView never runs and there is no html to read.
    await vscode.commands.executeCommand('betterCmm.panel.focus')

    // The extension exports its provider for exactly this purpose, so the
    // test reads the same webview VS Code renders rather than a re-render.
    // resolveWebviewView resolves asynchronously after focus, so poll rather
    // than sleep a fixed amount and risk a false failure on a slow host.
    const api = vscode.extensions.getExtension(EXTENSION_ID)?.exports as
      | { panelHtmlForTests?: () => string }
      | undefined
    for (let attempt = 0; attempt < 80; attempt += 1) {
      html = api?.panelHtmlForTests?.() ?? ''
      if (html !== '') {
        break
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    if (html !== '') {
      writeFileSync(DUMP_FILE, html)
    }
  })

  it('resolved the webview and produced markup', () => {
    assert.ok(html.length > 0, 'panel produced no html — the view never resolved')
  })

  it('injects the stylesheet, not just the markup', () => {
    // The defect that shipped twice: markup present, stylesheet absent,
    // leaving the unstyled button list the reference extension replaced.
    assert.match(html, /<style nonce="[a-f0-9]{32}">/)
    assert.ok(html.includes('metric-value'), 'stylesheet missing metric-value')
    assert.ok(html.includes('--tint'), 'stylesheet missing the --tint surface variable')
  })

  it('renders the rebuilt structure rather than the old flat list', () => {
    assert.ok(html.includes('brand-sub'), 'no header sub-title')
    assert.ok(html.includes('metrics'), 'no metric row')
    assert.ok(html.includes('chip'), 'no status chip')
    assert.doesNotMatch(html, /<table class="projects">/)
  })
})
