import * as assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * Checklist row C16 - no CLI processes are spawned while the panel is hidden.
 *
 * The row was human-only because an hour of watching is not a test, and it
 * stayed human-only after the first automation pass for a worse reason: on a
 * host with no CLI installed, `refresh()` returns before it launches anything
 * because `state.activePath` is null, so the row would pass for the wrong
 * reason as well as the right one. `CMM_FIXTURE_CLI` is what the autotest run
 * sets once it provisioned the pinned binary into a scratch HOME, so the row is
 * reported pending rather than passed without it.
 *
 * The observable is the extension's own log, not process enumeration: the timer
 * has exactly one branch that launches the CLI - `refresh()`, which ends in a
 * `refresh:` line - and the other branch, `updateBadgeCheck()`, launches nothing
 * and is counted by `updateChecksForTests`. A climbing counter with no `refresh:`
 * line is the whole row, and it holds identically on Windows and macOS, which a
 * `tasklist`/`ps` scan for a scratch-HOME path does not.
 */
const HAS_FIXTURE = process.env.CMM_FIXTURE_CLI !== undefined

interface TestApi {
  updateChecksForTests?: () => number
}

/**
 * The extension's log file, found the way a user finds it: `betterCmm.showLogs`
 * opens the file itself, so the active editor's path is the file. Same reading
 * path as `modal-actions.test.ts`, and no new seam.
 */
async function logFilePath(): Promise<string> {
  await vscode.commands.executeCommand('betterCmm.showLogs')
  const open = vscode.window.activeTextEditor?.document.uri.fsPath ?? ''
  return /better-cmm\.log$/.test(open) ? open : ''
}

function logText(path: string): string {
  return path !== '' && existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** What the extension appended since `before` was captured. */
function appended(before: string, after: string): string {
  assert.ok(after.startsWith(before), 'the log rotated mid-test; the delta cannot be read')
  return after.slice(before.length)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('idle cost with the panel hidden', () => {
  it('launches no CLI while the panel is hidden, and keeps ticking', async function () {
    if (!HAS_FIXTURE) {
      this.skip()
    }
    this.timeout(180_000)

    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    await extension?.activate()
    const api = extension?.exports as TestApi | undefined
    assert.ok(api?.updateChecksForTests, 'extension did not export the update-check counter')

    const config = vscode.workspace.getConfiguration('betterCmm')
    const previousInterval = config.get<number>('refreshIntervalSeconds')
    const previousLevel = config.get<string>('logLevel')
    // `refresh:` is a debug line, so the threshold has to let it through before
    // its absence can mean anything. Rearming the timer re-reads the interval,
    // and writing the setting is what triggers the rearm, so both writes land
    // before the window starts.
    await config.update('logLevel', 'debug', vscode.ConfigurationTarget.Global)
    await config.update('refreshIntervalSeconds', 5, vscode.ConfigurationTarget.Global)

    const log = await logFilePath()
    assert.notEqual(log, '', 'could not find the extension log file')

    try {
      // Positive control, and the guard against a vacuous pass: with the panel
      // visible the very same timer must produce `refresh:` lines. If it does
      // not, the negative assertion below proves nothing.
      await vscode.commands.executeCommand('betterCmm.panel.focus')
      const visibleFrom = logText(log)
      let sawRefresh = false
      for (let attempt = 0; attempt < 60 && !sawRefresh; attempt += 1) {
        await sleep(500)
        sawRefresh = /^.*\brefresh: /m.test(appended(visibleFrom, logText(log)))
      }
      assert.ok(sawRefresh, 'no refresh ran in 30s with the panel visible; the row cannot be read')

      // A refresh only launches the CLI once a binary resolved. Without that
      // the hidden window would be quiet for the wrong reason - which is
      // exactly why this row waited for the pinned-binary fixture.
      assert.match(
        logText(log),
        /offering .+ as an MCP server/,
        'no binary resolved, so a quiet hidden window would prove nothing',
      )

      await vscode.commands.executeCommand('workbench.action.closeSidebar')
      // The tick that was already in flight when the sidebar closed may still
      // write its line, and it is not part of the hidden window.
      await sleep(6_000)

      const hiddenFrom = logText(log)
      const ticksBefore = api.updateChecksForTests()
      // Three ticks at five seconds: long enough that a refresh would have had
      // several chances to fire, short enough not to trade an hour of manual
      // waiting for a minute of flake.
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (api.updateChecksForTests() >= ticksBefore + 3) {
          break
        }
        await sleep(500)
      }
      const ticks = api.updateChecksForTests() - ticksBefore
      assert.ok(ticks >= 3, `the timer stopped instead of ticking quietly (${String(ticks)} ticks)`)

      const during = appended(hiddenFrom, logText(log))
      const refreshLines = during.split('\n').filter((line) => /\brefresh: /.test(line))
      assert.deepEqual(
        refreshLines,
        [],
        `the CLI was launched while the panel was hidden:\n${refreshLines.join('\n')}`,
      )
    } finally {
      await config.update('refreshIntervalSeconds', previousInterval, vscode.ConfigurationTarget.Global)
      await config.update('logLevel', previousLevel, vscode.ConfigurationTarget.Global)
      // Leave the host the way this test found it: closed.
      await vscode.commands.executeCommand('workbench.action.closeSidebar')
    }
  })
})
