import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { COMMAND_IDS } from '../../src/commands'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

describe('extension activation', () => {
  it('activates without throwing', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(extension, 'extension not found')
    await extension.activate()
    assert.equal(extension.isActive, true)
  })

  it('registers every declared command', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate()
    const registered = await vscode.commands.getCommands(true)
    for (const id of COMMAND_IDS) {
      assert.ok(registered.includes(id), `missing command: ${id}`)
    }
  })

  it('exposes the settings with their declared defaults', async () => {
    const config = vscode.workspace.getConfiguration('betterCmm')
    assert.equal(config.get('binarySource'), 'auto')
    assert.equal(config.get('autoRefresh'), true)
  })

  it('leaves the workspace folders untouched on activation', async () => {
    const before = vscode.workspace.workspaceFolders?.length ?? 0
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate()
    assert.equal(vscode.workspace.workspaceFolders?.length ?? 0, before)
  })

  it('copies the uninstall command to the clipboard without opening a terminal', async () => {
    const terminalsBefore = vscode.window.terminals.length
    await vscode.commands.executeCommand('betterCmm.copyUninstallCommand')
    assert.equal(await vscode.env.clipboard.readText(), 'codebase-memory-mcp uninstall')
    assert.equal(vscode.window.terminals.length, terminalsBefore)
  })

  it('copies the install command as well', async () => {
    await vscode.commands.executeCommand('betterCmm.copyInstallCommand')
    assert.equal(await vscode.env.clipboard.readText(), 'codebase-memory-mcp install')
  })
})
