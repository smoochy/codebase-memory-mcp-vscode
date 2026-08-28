import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * Checklist row B5: opening a repository must not make that repository an
 * indexed project, and must not add anything to the workspace.
 *
 * This suite is its own launch because the rest of the integration tier runs
 * on an empty window, where the row cannot be observed at all. The folder is
 * this repo's own checkout, passed as a launch argument by runTest.ts.
 *
 * What this proves and what it does not: the host has no CLI binary, so the
 * project list is empty for that reason as well as for the right one. The
 * assertion that carries weight is therefore the negative one - no card in the
 * rendered panel names the open folder - together with the workspace staying
 * exactly one folder across activation and a refresh. A host with a real
 * binary would make the same assertions sharper; that fixture is a separate
 * ticket.
 */
describe('an open repository is not treated as a project', () => {
  let html = ''
  let root: vscode.Uri

  before(async function () {
    this.timeout(60_000)
    const folders = vscode.workspace.workspaceFolders ?? []
    assert.equal(folders.length, 1, 'the workspace pass launched without a folder open')
    root = folders[0]!.uri

    await vscode.extensions.getExtension(EXTENSION_ID)?.activate()
    // Focusing the view is what makes VS Code resolve the provider; without it
    // there is no markup to read. Same shape as panel-render.test.ts.
    await vscode.commands.executeCommand('betterCmm.panel.focus')
    await vscode.commands.executeCommand('betterCmm.refresh')

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
    assert.ok(html.length > 0, 'panel produced no html - the view never resolved')
  })

  it('leaves the workspace at the one folder it was launched with', () => {
    assert.equal(vscode.workspace.workspaceFolders?.length, 1)
    assert.equal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, root.fsPath)
  })

  it('does not render the open folder as a project card', () => {
    // Project cards carry the path in a title attribute and the name in
    // data-project; both are what a self-registered workspace would show up as.
    const cardPaths = [...html.matchAll(/class="card-path" title="([^"]*)"/g)].map((m) => m[1] ?? '')
    const cardNames = [...html.matchAll(/data-project="([^"]*)"/g)].map((m) => m[1] ?? '')
    const fsPath = root.fsPath.replace(/\\/g, '/')
    for (const path of cardPaths) {
      assert.notEqual(
        path.replace(/\\/g, '/').toLowerCase(),
        fsPath.toLowerCase(),
        `the workspace folder is listed as a project: ${path}`,
      )
    }
    const folderName = fsPath.slice(fsPath.lastIndexOf('/') + 1)
    assert.ok(
      !cardNames.includes(folderName),
      `a project card is named after the workspace folder: ${folderName}`,
    )
  })
})
