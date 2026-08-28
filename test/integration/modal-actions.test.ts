import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * Checklist rows B7 (remove-project confirmation) and the add-repositories
 * row, which were human-only for one reason: both commands open a modal and a
 * modal blocks an unattended host forever.
 *
 * The suite and the extension share one `vscode` module object, so assigning
 * `vscode.window.showWarningMessage` or `showOpenDialog` from here captures the
 * call the extension makes, message text intact, and answers it immediately.
 * No extension seam is involved.
 *
 * Whether the confirmed branch actually reached the CLI is read from the log
 * file the extension writes, which is the only externally visible record of it.
 */

/**
 * Only a run that provisioned the pinned CLI into a scratch HOME may drive the
 * halves of these rows that mutate the CLI's store. `npm run test:integration`
 * on a developer machine resolves that developer's real binary and real index,
 * and indexing a throwaway folder into it would be a test corrupting the thing
 * it is run from. `CMM_FIXTURE_CLI` is what runTest.ts forwards into the host
 * when scripts/autotest.mjs provisioned the fixture; without it those halves
 * are reported pending rather than passed, so the run can never go green on
 * assertions that never executed.
 */
const HAS_FIXTURE = process.env.CMM_FIXTURE_CLI !== undefined

interface TestApi {
  panelHtmlForTests?: () => string
}

function api(): TestApi | undefined {
  return vscode.extensions.getExtension(EXTENSION_ID)?.exports as TestApi | undefined
}

/** Project names the panel currently offers a remove button for. */
function renderedProjects(): Set<string> {
  const html = api()?.panelHtmlForTests?.() ?? ''
  return new Set(
    [...html.matchAll(/data-command="betterCmm\.removeProject" data-project="([^"]+)"/g)].map(
      (match) => match[1]!,
    ),
  )
}

/**
 * The extension's own log file, found the way a user finds it. `betterCmm.showLogs`
 * opens the file itself in an editor (asserted in panel-render.test.ts), so the
 * active editor's path is the file, with no new seam to expose it.
 */
async function logFilePath(): Promise<string> {
  await vscode.commands.executeCommand('betterCmm.showLogs')
  const open = vscode.window.activeTextEditor?.document.uri.fsPath ?? ''
  return /better-cmm\.log$/.test(open) ? open : ''
}

function logText(path: string): string {
  return path !== '' && existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** Lines the extension appended to the log since `before` was captured. */
function appendedLines(before: string, after: string): string[] {
  assert.ok(after.startsWith(before), 'the log rotated mid-test; the delta cannot be read')
  return after.slice(before.length).split('\n').filter((line) => line.trim() !== '')
}

describe('commands behind a modal dialog', () => {
  const originalOpenDialog = vscode.window.showOpenDialog
  const originalWarning = vscode.window.showWarningMessage

  let fixtureFolder = ''
  let addedProject: string | null = null
  let logPath = ''

  before(async function () {
    this.timeout(120_000)
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate()
    // Resolving the view is what makes the panel markup readable, and the
    // markup is where an added project's CLI-derived name comes from.
    await vscode.commands.executeCommand('betterCmm.panel.focus')
    logPath = await logFilePath()
  })

  afterEach(() => {
    // Restored after every test, not once at the end: a failing assertion must
    // not leave a stub installed for the next file mocha loads, or a command
    // loop elsewhere in the suite would answer a dialog it never opened.
    vscode.window.showOpenDialog = originalOpenDialog
    vscode.window.showWarningMessage = originalWarning
  })

  after(() => {
    if (fixtureFolder !== '') {
      rmSync(fixtureFolder, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    }
  })

  it('opens a folder picker for add repositories, and a dismissal is a no-op', async function () {
    this.timeout(60_000)
    let options: vscode.OpenDialogOptions | undefined
    vscode.window.showOpenDialog = ((given?: vscode.OpenDialogOptions) => {
      options = given
      // Dismissal: the command must return without touching anything.
      return Promise.resolve(undefined)
    }) as typeof vscode.window.showOpenDialog

    const before = logText(logPath)
    await vscode.commands.executeCommand('betterCmm.addProject')

    assert.ok(options !== undefined, 'addProject did not open a folder picker')
    assert.equal(options.canSelectFolders, true)
    assert.equal(options.canSelectFiles, false)
    assert.equal(options.canSelectMany, true)
    assert.equal(options.openLabel, 'Add repositories')
    assert.deepEqual(
      appendedLines(before, logText(logPath)).filter((line) => line.includes('User: added')),
      [],
      'a dismissed picker still indexed something',
    )
  })

  it('indexes the folder the picker returns', async function () {
    if (!HAS_FIXTURE) {
      // Pending, not passing: there is no isolated store to index into.
      this.skip()
    }
    this.timeout(300_000)

    fixtureFolder = mkdtempSync(join(tmpdir(), 'cbm-modal-'))
    writeFileSync(join(fixtureFolder, 'sample.py'), 'def sample():\n    return 1\n')

    const known = renderedProjects()
    vscode.window.showOpenDialog = (() =>
      Promise.resolve([vscode.Uri.file(fixtureFolder)])) as typeof vscode.window.showOpenDialog

    const before = logText(logPath)
    await vscode.commands.executeCommand('betterCmm.addProject')

    const added = [...renderedProjects()].filter((name) => !known.has(name))
    assert.equal(
      added.length,
      1,
      `expected exactly one new project, got [${added.join(', ')}]; log: ` +
        appendedLines(before, logText(logPath)).join(' | '),
    )
    addedProject = added[0]!
  })

  it('names the project in the confirmation, and a dismissal never reaches the CLI', async function () {
    if (!HAS_FIXTURE || addedProject === null) {
      this.skip()
    }
    this.timeout(60_000)

    let prompt = ''
    let modal = false
    vscode.window.showWarningMessage = ((
      message: string,
      options?: vscode.MessageOptions,
      ...items: string[]
    ) => {
      prompt = message
      modal = options?.modal === true
      assert.ok(items.includes('Remove'), `no Remove action offered: [${items.join(', ')}]`)
      // Dismissal is `undefined`, the same value VS Code returns when the user
      // closes the modal without choosing.
      return Promise.resolve(undefined)
    }) as unknown as typeof vscode.window.showWarningMessage

    const before = logText(logPath)
    await vscode.commands.executeCommand('betterCmm.removeProject', addedProject)

    assert.ok(prompt.includes(addedProject!), `confirmation does not name the project: ${prompt}`)
    assert.ok(modal, 'the confirmation was not modal')
    assert.deepEqual(
      appendedLines(before, logText(logPath)).filter((line) => /User: (removed|removing)/.test(line)),
      [],
      'a dismissed confirmation still reached the CLI',
    )
    assert.ok(renderedProjects().has(addedProject!), 'a dismissed confirmation removed the project')
  })

  it('removes the project once the confirmation is accepted', async function () {
    if (!HAS_FIXTURE || addedProject === null) {
      this.skip()
    }
    this.timeout(120_000)

    vscode.window.showWarningMessage = (() =>
      Promise.resolve('Remove')) as unknown as typeof vscode.window.showWarningMessage

    const before = logText(logPath)
    await vscode.commands.executeCommand('betterCmm.removeProject', addedProject)

    const removals = appendedLines(before, logText(logPath)).filter((line) =>
      /User: (removed|removing)/.test(line),
    )
    assert.equal(removals.length, 1, `expected one removal line, got [${removals.join(' | ')}]`)
    assert.match(removals[0]!, /User: removed /, removals[0]!)
    assert.ok(!renderedProjects().has(addedProject!), 'the project is still listed after removal')
    addedProject = null
  })
})
