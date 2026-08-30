import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * Checklist row B4: with `binarySource` set to `external` and a real binary to
 * point at, the panel offers neither Setup nor Update, and still lists
 * projects.
 *
 * The config half alone would prove nothing - the state machine resolves
 * `external` to "no binary" when the configured path does not exist, which is
 * the `needs-setup` screen and would pass an assertion about the update button
 * for the wrong reason. So the row needs the pinned fixture binary, and without
 * it the test is pending rather than passing (the convention modal-actions and
 * panel-hidden-idle already use).
 *
 * Nothing here mutates the CLI's store: the setting is read back to `auto` in a
 * `finally`, following `update-check.test.ts`, because this file shares one
 * extension host with every other file in the default suite and a leaked
 * `external` source would change what those files render.
 */
const FIXTURE_CLI = process.env.CMM_FIXTURE_CLI

interface TestApi {
  panelHtmlForTests?: () => string
}

function panelHtml(): string {
  const api = vscode.extensions.getExtension(EXTENSION_ID)?.exports as TestApi | undefined
  return api?.panelHtmlForTests?.() ?? ''
}

/** The panel redraws on its own after a config change; wait for the redraw. */
async function htmlMatching(predicate: (html: string) => boolean): Promise<string> {
  let html = ''
  for (let attempt = 0; attempt < 80; attempt += 1) {
    html = panelHtml()
    if (html !== '' && predicate(html)) {
      return html
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return html
}

describe('an external binary', () => {
  before(async function () {
    this.timeout(60_000)
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate()
    // Resolving the view is what produces markup at all; without the focus
    // `panelHtmlForTests` answers the empty string forever.
    await vscode.commands.executeCommand('betterCmm.panel.focus')
  })

  it('offers no Setup and no Update button, and still lists projects', async function () {
    if (FIXTURE_CLI === undefined) {
      // Pending, not passing: `external` without a real binary resolves to the
      // needs-setup screen, and asserting against that proves the opposite.
      this.skip()
    }
    this.timeout(120_000)

    const config = vscode.workspace.getConfiguration('betterCmm')
    const previousSource = config.get<string>('binarySource')
    const previousPath = config.get<string>('externalBinaryPath')

    try {
      await config.update('externalBinaryPath', FIXTURE_CLI, vscode.ConfigurationTarget.Global)
      await config.update('binarySource', 'external', vscode.ConfigurationTarget.Global)

      // The binary's own version carries the resolved source in its tooltip, so
      // this is the assertion that says the fixture was really adopted rather
      // than that the panel happens to render without an update offer.
      const html = await htmlMatching((markup) => /title="[^"]*\(external\)/.test(markup))
      assert.match(
        html,
        /title="[^"]*\(external\)/,
        'the panel never reported an external binary; the fixture was not adopted',
      )

      assert.doesNotMatch(
        html,
        /data-command="betterCmm\.runSetup"/,
        'the panel still offers Setup for a binary the extension does not own',
      )
      assert.doesNotMatch(
        html,
        /data-command="betterCmm\.updateBinary"/,
        'the panel still offers Update for a binary the extension does not own',
      )
      // The projects section is what "the panel still works" means here: an
      // external source must not reduce the panel to the setup screen, which
      // renders no such section at all.
      assert.ok(
        html.includes('<h2>Projects</h2>'),
        'the panel dropped the projects section under an external binary',
      )
    } finally {
      // Awaited, so mocha does not start the next file while the host is still
      // on the external source.
      await config.update('binarySource', previousSource, vscode.ConfigurationTarget.Global)
      await config.update('externalBinaryPath', previousPath, vscode.ConfigurationTarget.Global)
    }
  })
})
