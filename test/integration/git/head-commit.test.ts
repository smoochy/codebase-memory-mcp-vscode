import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

interface GitApi {
  repositories: { rootUri: vscode.Uri }[]
  getRepository(uri: vscode.Uri): unknown
  openRepository(uri: vscode.Uri): Thenable<unknown>
}

/** A checkout outside the workspace, standing in for an indexed project. */
function foreignCheckout(): { path: string; head: string } {
  const path = mkdtempSync(join(tmpdir(), 'cbm-foreign-'))
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  writeFileSync(join(path, 'README.md'), 'foreign project\n')
  git('add', '.')
  git('commit', '-qm', 'initial')
  return { path, head: git('rev-parse', 'HEAD').trim() }
}

/**
 * Issue #40: every indexed project ended up registered with the built-in git
 * extension, so VS Code asked to open repositories the user never opened and
 * the Source Control view filled with folders from other projects.
 *
 * This suite runs with extensions enabled - the rest of the integration tier
 * launches with `--disable-extensions`, where `vscode.git` is inactive and the
 * bug cannot appear at all.
 */
describe('reading a head commit does not register foreign repositories', () => {
  let api: GitApi
  let project: { path: string; head: string }

  before(async function () {
    this.timeout(60_000)
    const git = vscode.extensions.getExtension('vscode.git')
    assert.ok(git, 'the built-in git extension is missing')
    await git.activate()
    api = (git.exports as { getAPI(version: 1): GitApi }).getAPI(1)
    project = foreignCheckout()
  })

  const registered = (path: string): boolean =>
    api.repositories.some((repo) => repo.rootUri.fsPath.toLowerCase() === path.toLowerCase())

  it('starts with the checkout unknown to the git extension', () => {
    assert.equal(registered(project.path), false)
  })

  it('reads the head of a project outside the workspace', async function () {
    this.timeout(30_000)
    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(extension)
    await extension.activate()
    const api = extension.exports as { headCommitForTests?: (p: string) => Promise<string | null> }
    assert.ok(api.headCommitForTests, 'the extension exports no head reader to test')
    assert.equal(await api.headCommitForTests(project.path), project.head)
  })

  it('leaves the checkout out of the Source Control view', () => {
    // The regression this file exists for: `openRepository` answered with the
    // same commit and registered the folder as a side effect.
    assert.equal(
      registered(project.path),
      false,
      'reading the head registered the project with the git extension',
    )
  })

  it('answers null for a directory that is not a checkout', async function () {
    this.timeout(30_000)
    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    const api = extension?.exports as { headCommitForTests?: (p: string) => Promise<string | null> }
    const plain = mkdtempSync(join(tmpdir(), 'cbm-plain-'))
    assert.equal(await api.headCommitForTests?.(plain), null)
  })

  // Runs last: it registers the repository on purpose and would poison the
  // assertions above. Without it a passing suite proves nothing, because a
  // test that can never observe the failure is not a test.
  it('would have seen the old behaviour - openRepository does register it', async function () {
    this.timeout(30_000)
    const other = foreignCheckout()
    assert.equal(registered(other.path), false)
    await api.openRepository(vscode.Uri.file(other.path))
    assert.equal(registered(other.path), true, 'openRepository no longer registers - re-check #40')
  })
})
