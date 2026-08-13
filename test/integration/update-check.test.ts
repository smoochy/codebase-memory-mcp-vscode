import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * The badge exists so a release is visible without opening the panel, and the
 * refresh timer deliberately skips the ticks where the panel is off screen. So
 * what has to hold on a real host is that those skipped ticks still run the
 * update check.
 *
 * The offer itself is not asserted here: the runner has no CLI installed, so
 * there is no installed version to compare a release against. That comparison
 * is the unit tier's, in `state-machine.test.ts` and `binary-fetch.test.ts`.
 */
describe('update check with the panel hidden', () => {
  it('keeps checking on the timer while the panel is not visible', async function () {
    this.timeout(60_000)

    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    await extension?.activate()
    const api = extension?.exports as { updateChecksForTests?: () => number } | undefined
    assert.ok(api?.updateChecksForTests, 'extension did not export the update-check counter')

    // Rearming the timer is what re-reads this, and writing the setting is
    // what triggers the rearm, so the short interval takes effect here.
    const config = vscode.workspace.getConfiguration('betterCmm')
    const previous = config.get<number>('refreshIntervalSeconds')
    await config.update('refreshIntervalSeconds', 5, vscode.ConfigurationTarget.Global)
    // The panel is a webview view; with the sidebar closed it is not visible,
    // which is the state the refresh timer skips.
    await vscode.commands.executeCommand('workbench.action.closeSidebar')

    try {
      const before = api.updateChecksForTests()
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (api.updateChecksForTests() > before) {
          return
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      assert.fail('no update check ran in 20s with the panel hidden')
    } finally {
      await config.update('refreshIntervalSeconds', previous, vscode.ConfigurationTarget.Global)
    }
  })
})
