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
    assert.ok(html.length > 0, 'panel produced no html - the view never resolved')
  })

  it('injects the stylesheet, not just the markup', () => {
    // The defect that shipped twice: markup present, stylesheet absent,
    // leaving the unstyled button list the reference extension replaced.
    assert.match(html, /<style nonce="[a-f0-9]{32}">/)
    assert.ok(html.includes('metric-value'), 'stylesheet missing metric-value')
    assert.ok(html.includes('--tint'), 'stylesheet missing the --tint surface variable')
  })

  it('shows the extension version, so the installed build is identifiable', () => {
    const declared = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON as {
      version: string
    }
    assert.ok(
      html.includes(`v${declared.version}`),
      `panel does not show extension version ${declared.version}`,
    )
  })

  it('binds clicks through an Element guard, so icon clicks still register', () => {
    // The buttons wrap an inline <svg>; an SVG node is an SVGElement, so an
    // HTMLElement guard dropped every click that landed on an icon.
    assert.ok(html.includes('instanceof Element'))
    assert.doesNotMatch(html, /target instanceof HTMLElement/)
  })

  it('wires every panel button to a command VS Code actually registered', async () => {
    // "The button has no function" is what an unregistered or misspelled
    // data-command looks like from the outside, and nothing caught it before:
    // the panel and the manifest were only ever checked separately.
    const registered = await vscode.commands.getCommands(true)
    const wired = [...html.matchAll(/data-command="([^"]+)"/g)].map((m) => m[1])
    assert.ok(wired.length > 0, 'panel rendered no buttons at all')
    for (const command of new Set(wired)) {
      assert.ok(registered.includes(command!), `panel button targets unregistered ${command!}`)
    }
  })

  // Executing each one proves the handler runs. A handler that throws is
  // indistinguishable from a dead button in the UI. Commands that open a modal
  // dialog (addProject, removeProject) are excluded - they would block here.
  //
  // The bounds are not one shared number, because these commands do not await
  // the same amount of real work. A refresh awaits one `list_projects`, whose
  // own CliClient timeout is 30_000 - so a 30_000 bound here raced the call it
  // was waiting on and could not tell a hung CLI from a slow one. Reindex is
  // one `index_repository` per registered project in sequence, so its runtime
  // is a property of the developer's store rather than of the extension:
  // measured on a warm 16-project store, 2.4-4.0 s each and 49.7 s in total.
  // ponytail: a flat ceiling rather than one derived from the project count -
  // it fails loudly on a store several times that size, which is the point at
  // which this test measures the binary and should be reconsidered, not raised.
  const BOUND_MS: Record<string, number> = { 'betterCmm.reindex': 240_000 }
  for (const command of [
    'betterCmm.refresh',
    'betterCmm.showLogs',
    'betterCmm.openSettings',
    'betterCmm.reindex',
  ]) {
    it(`executes ${command} without throwing`, async function () {
      this.timeout(BOUND_MS[command] ?? 60_000)
      await vscode.commands.executeCommand(command)
    })
  }

  it('offers the settings and refresh actions in the view title bar', () => {
    const manifest = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON as {
      contributes: { menus?: Record<string, { command: string; when?: string }[]> }
    }
    const title = manifest.contributes.menus?.['view/title'] ?? []
    const commands = title.map((entry) => entry.command)
    // The gear opens the panel's own settings screen rather than VS Code's,
    // because the CLI's keys are discovered at runtime and a static settings
    // UI cannot render them.
    assert.ok(commands.includes('betterCmm.showSettings'), 'no settings gear in the title bar')
    assert.ok(commands.includes('betterCmm.refresh'), 'no refresh in the title bar')
    for (const entry of title) {
      assert.equal(entry.when, 'view == betterCmm.panel')
    }
  })

  it('opens the log file itself, not just the output channel', async function () {
    this.timeout(30_000)
    await vscode.commands.executeCommand('betterCmm.showLogs')
    // The log is written on the first refresh, so by now it exists and the
    // command must have put it in an editor rather than revealing a panel.
    const open = vscode.window.activeTextEditor?.document.uri.fsPath ?? ''
    assert.match(open, /better-cmm\.log$/)
  })

  it('renders the rebuilt structure rather than the old flat list', () => {
    assert.ok(html.includes('brand-sub'), 'no header sub-title')
    assert.ok(html.includes('metrics'), 'no metric row')
    assert.ok(html.includes('chip'), 'no status chip')
    assert.doesNotMatch(html, /<table class="projects">/)
  })
})
