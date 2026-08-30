import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { COMMAND_IDS } from '../../../src/commands'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * Checklist row A1 - the first start of an installed build in a clean profile.
 *
 * This suite exists because the row cannot be answered by the other integration
 * suites at all. They load unpacked sources through `extensionDevelopmentPath`,
 * which puts the extension host in development mode, and an installed `.vsix`
 * never is. `runTest.ts` gives this suite its own launch: the packaged `.vsix`
 * installed into a scratch extensions directory, no `extensionDevelopmentPath`
 * and no `--disable-extensions`, so what activates here is the artifact a user
 * would install rather than the checkout.
 *
 * What that host can be asked is narrower than what the others can. `activate()`
 * returns `{}` when `context.extensionMode === vscode.ExtensionMode.Production`
 * (src/extension.ts), so `panelHtmlForTests` and `updateChecksForTests` are
 * absent by design and every assertion about rendered markup belongs to the
 * other suites. What is left is what a first start actually promises: the
 * extension activates without throwing, its declared commands are registered,
 * its declared setting defaults read back, and its MCP server definition
 * provider is contributed.
 *
 * The first test is the guard on the rest. Without it a regression in the
 * install step - a `.vsix` that never installed, a scratch extensions directory
 * the host ignored - would leave the development copy running and every
 * assertion below would pass while testing nothing this row asks about.
 */
describe('installed build first start', () => {
  it('activates a production installation without error', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(extension, 'the packaged extension is not installed in this host')

    const exported: unknown = await extension.activate()
    assert.equal(extension.isActive, true)

    // The development-mode seams are the tell. Their absence is what says this
    // host loaded an installed build rather than the checkout, and it is the
    // only signal available from inside the extension host - `extensionMode`
    // belongs to the activation context, which production deliberately does not
    // hand back.
    assert.deepEqual(
      exported,
      {},
      'the test seams are exported, so this host is running the development copy, not the installed build',
    )
  })

  it('registers every declared command', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate()
    const registered = await vscode.commands.getCommands(true)
    for (const id of COMMAND_IDS) {
      assert.ok(registered.includes(id), `missing command: ${id}`)
    }
  })

  it('exposes the settings with their declared defaults', () => {
    const config = vscode.workspace.getConfiguration('betterCmm')
    assert.equal(config.get('binarySource'), 'auto')
    assert.equal(config.get('autoRefresh'), true)
  })

  // Manifest plus API surface, which is as far as an installed build reaches:
  // the host offers no way to enumerate the providers actually registered, so
  // this asserts that the contribution shipped in the packaged manifest and
  // that the API the extension registers against exists on this host. That the
  // registration call itself succeeded is carried by the activation test above
  // - a throwing `registerMcpServerDefinitionProvider` would fail activation.
  it('ships the MCP server definition provider contribution', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(extension)
    await extension.activate()
    const contributed = (
      extension.packageJSON as { contributes: { mcpServerDefinitionProviders?: { id: string }[] } }
    ).contributes.mcpServerDefinitionProviders
    assert.deepEqual(contributed?.map((entry) => entry.id), ['betterCmm.codebaseMemory'])
    assert.equal(typeof vscode.lm.registerMcpServerDefinitionProvider, 'function')
  })
})
