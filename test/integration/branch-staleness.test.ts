import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * Checklist row B18: against a 0.10.x binary the panel names the branch a
 * project was indexed from, and reports the project outdated once the checkout
 * moves to another commit.
 *
 * Both halves index a real repository into the CLI's store, so both need the
 * pinned fixture and its scratch HOME - `npm run test:integration` on a
 * developer machine would otherwise write a throwaway folder into that
 * developer's own index. Without `CMM_FIXTURE_CLI` the tests are pending, never
 * passing.
 *
 * The panel markup is the observable rather than the log line: the log says
 * "outdated" once per change (`reportedStale` in extension.ts dedupes across
 * ticks), while the markup always reflects the current state and can therefore
 * be polled after an explicit refresh.
 */
const HAS_FIXTURE = process.env.CMM_FIXTURE_CLI !== undefined

interface TestApi {
  panelHtmlForTests?: () => string
  headCommitForTests?: (rootPath: string) => Promise<string | null>
}

function panelHtml(): string {
  const api = vscode.extensions.getExtension(EXTENSION_ID)?.exports as TestApi | undefined
  return api?.panelHtmlForTests?.() ?? ''
}

/** Project names the panel currently renders a card for. */
function renderedProjects(): Set<string> {
  return new Set(
    [...panelHtml().matchAll(/data-command="betterCmm\.removeProject" data-project="([^"]+)"/g)].map(
      (match) => match[1]!,
    ),
  )
}

/**
 * The one card belonging to `project`, so a branch or a stale tag from some
 * other indexed project can never satisfy an assertion here.
 */
function cardFor(project: string): string {
  for (const card of panelHtml().split('<div class="card">').slice(1)) {
    if (card.includes(`data-project="${project}"`)) {
      return card
    }
  }
  return ''
}

/** Refreshes until the project's card satisfies `predicate`, then returns it. */
async function cardMatching(project: string, predicate: (card: string) => boolean): Promise<string> {
  let card = ''
  for (let attempt = 0; attempt < 40; attempt += 1) {
    card = cardFor(project)
    if (card !== '' && predicate(card)) {
      return card
    }
    await vscode.commands.executeCommand('betterCmm.refresh')
    await new Promise((r) => setTimeout(r, 500))
  }
  return card
}

function git(path: string, ...args: string[]): string {
  return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' })
}

describe('branch and staleness of an indexed checkout', () => {
  const originalOpenDialog = vscode.window.showOpenDialog
  const originalWarning = vscode.window.showWarningMessage

  let checkout = ''
  let branch = ''
  let project: string | null = null

  before(async function () {
    if (!HAS_FIXTURE) {
      this.skip()
    }
    this.timeout(120_000)
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate()
    await vscode.commands.executeCommand('betterCmm.panel.focus')

    // The real path, not the one `tmpdir()` hands out: on Windows that is the
    // 8.3 short form (`C:\Users\ADMINI~1\...`), while the CLI reports the long
    // form back. The extension matches the picked folder against the CLI's
    // root by string, so the short form would never match and the project
    // would get no index note - and without a note there is nothing to compare
    // a moved head against, so staleness could never be reported.
    checkout = realpathSync.native(mkdtempSync(join(tmpdir(), 'cbm-branch-')))
    git(checkout, 'init', '-q')
    git(checkout, 'config', 'user.email', 'test@example.invalid')
    git(checkout, 'config', 'user.name', 'test')
    writeFileSync(join(checkout, 'sample.py'), 'def sample():\n    return 1\n')
    git(checkout, 'add', '.')
    git(checkout, 'commit', '-qm', 'initial')
    branch = git(checkout, 'rev-parse', '--abbrev-ref', 'HEAD').trim()
  })

  after(async function () {
    this.timeout(120_000)
    vscode.window.showOpenDialog = originalOpenDialog
    // The project is removed through the extension, not just off disk: a
    // dangling entry pointing at a deleted directory outlives this file and
    // would be reindexed by the reindex-all test in panel-render.test.ts.
    if (project !== null) {
      vscode.window.showWarningMessage = (() =>
        Promise.resolve('Remove')) as unknown as typeof vscode.window.showWarningMessage
      await vscode.commands.executeCommand('betterCmm.removeProject', project)
    }
    vscode.window.showWarningMessage = originalWarning
    if (checkout !== '') {
      try {
        rmSync(checkout, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      } catch {
        // The CLI keeps the checkout open for a while after indexing it, and on
        // Windows that is an EPERM here. The folder is in the system temp
        // directory and the project is already out of the index, so failing the
        // suite over it would report a cleanup detail as a broken extension.
      }
    }
  })

  it('names the branch the project was indexed from', async function () {
    this.timeout(300_000)

    const known = renderedProjects()
    vscode.window.showOpenDialog = (() =>
      Promise.resolve([vscode.Uri.file(checkout)])) as typeof vscode.window.showOpenDialog
    try {
      await vscode.commands.executeCommand('betterCmm.addProject')
    } finally {
      vscode.window.showOpenDialog = originalOpenDialog
    }

    const added = [...renderedProjects()].filter((name) => !known.has(name))
    assert.equal(added.length, 1, `expected one new project, got [${added.join(', ')}]`)
    project = added[0]!

    const card = await cardMatching(project, (markup) => markup.includes('<span class="branch"'))
    assert.match(
      card,
      new RegExp(`<span class="branch"[^>]*>${branch}</span>`),
      `the card does not name branch ${branch}: ${card}`,
    )
  })

  it('reports the project outdated once the checkout moves on', async function () {
    if (project === null) {
      this.skip()
    }
    this.timeout(180_000)

    // Let the index note settle on the head it was built from before the
    // checkout moves. `advanceIndexRecord` adopts the current head whenever the
    // store file is newer than the note, and the note is written when the
    // picker returns - which is before the CLI has finished writing the store.
    // Committing while that is still true makes the extension adopt the *new*
    // head as the one it indexed, and the staleness it should report never
    // appears. Refreshing twice first closes that window: the adoption happens
    // against the old head and moves the note's timestamp up to the store's.
    for (let settle = 0; settle < 2; settle += 1) {
      await vscode.commands.executeCommand('betterCmm.refresh')
      await new Promise((r) => setTimeout(r, 1_000))
    }

    // Staleness is a comparison against the checkout's head, so a host that
    // cannot read one reports nothing rather than reporting fresh. Asserted
    // separately, because the two failures look identical in the markup.
    const api = vscode.extensions.getExtension(EXTENSION_ID)?.exports as TestApi | undefined
    const head = await api?.headCommitForTests?.(checkout)
    assert.equal(
      head,
      git(checkout, 'rev-parse', 'HEAD').trim(),
      'the extension host cannot read the checkout head, so staleness cannot be decided',
    )

    const before = cardFor(project)
    assert.ok(
      !before.includes('<span class="stale"'),
      'the project was already outdated before the checkout moved',
    )

    writeFileSync(join(checkout, 'later.py'), 'def later():\n    return 2\n')
    git(checkout, 'add', '.')
    git(checkout, 'commit', '-qm', 'second')

    const card = await cardMatching(project, (markup) => markup.includes('<span class="stale"'))
    assert.ok(
      card.includes('<span class="stale"'),
      `the card reports no staleness after the head moved: ${card}`,
    )
  })
})
