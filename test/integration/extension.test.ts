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

  // Checklist row B13, the half a test can answer: what lands in the clipboard
  // on the operating system this run is on. Whether the pasted line then runs
  // in the shell it is labelled for stays human - that is the half that found
  // the Git Bash defect, and no test host can paste into a real shell.
  //
  // The four commands are asserted together because they are one rule with two
  // axes: which subcommand, and which shell spelling. A bare command is the
  // documented fallback when no binary resolved, which is this host's case, so
  // each assertion has to accept both shapes without accepting a wrong one.
  const CLIPBOARD_ROWS: { command: string; bare: string; bash: boolean }[] = [
    { command: 'betterCmm.copyUninstallCommand', bare: 'codebase-memory-mcp uninstall', bash: false },
    {
      command: 'betterCmm.copyUninstallCommandBash',
      bare: 'codebase-memory-mcp uninstall',
      bash: true,
    },
    {
      command: 'betterCmm.copyDaemonStopCommand',
      bare: 'codebase-memory-mcp daemon stop',
      bash: false,
    },
    {
      command: 'betterCmm.copyDaemonStopCommandBash',
      bare: 'codebase-memory-mcp daemon stop',
      bash: true,
    },
  ]

  for (const row of CLIPBOARD_ROWS) {
    it(`copies a runnable ${row.command} string for this platform`, async () => {
      const terminalsBefore = vscode.window.terminals.length
      await vscode.commands.executeCommand(row.command)
      const copied = await vscode.env.clipboard.readText()
      const subcommand = row.bare.slice('codebase-memory-mcp '.length)

      assert.ok(copied.endsWith(subcommand), `${row.command} copied: ${copied}`)
      if (copied === row.bare) {
        // No binary resolved on this host; the bare command is the fallback.
        assert.equal(vscode.window.terminals.length, terminalsBefore)
        return
      }

      assert.ok(copied.includes('"'), `a bound command must quote its path: ${copied}`)
      if (row.bash) {
        // Git Bash reads a leading & as a background job, and it takes forward
        // slashes. Both were real defects.
        assert.ok(!copied.startsWith('&'), `Git Bash cannot parse a call operator: ${copied}`)
        assert.ok(!copied.includes('\\'), `a Git Bash path must use forward slashes: ${copied}`)
      } else if (process.platform === 'win32') {
        // PowerShell is the default terminal there, and a quoted string in
        // command position is a parse error without the call operator.
        assert.ok(copied.startsWith('& "'), `PowerShell needs the call operator: ${copied}`)
      } else {
        assert.ok(copied.startsWith('"'), `unexpected spelling for this platform: ${copied}`)
      }
      assert.equal(vscode.window.terminals.length, terminalsBefore)
    })
  }

  // The server reaches VS Code through a provider rather than a file, so the
  // contribution point and the API behind it both have to be there on the host
  // the engines range now names.
  it('contributes an MCP server definition provider the host supports', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(extension)
    const contributed = (
      extension.packageJSON as { contributes: { mcpServerDefinitionProviders?: { id: string }[] } }
    ).contributes.mcpServerDefinitionProviders
    assert.deepEqual(contributed?.map((entry) => entry.id), ['betterCmm.codebaseMemory'])
    assert.equal(typeof vscode.lm.registerMcpServerDefinitionProvider, 'function')
  })
})
