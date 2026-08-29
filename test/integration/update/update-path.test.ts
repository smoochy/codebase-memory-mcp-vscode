import * as assert from 'node:assert/strict'
import { spawnSync, spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'smoochy.better-codebase-memory-mcp'

/**
 * Checklist rows A10, A11 and B17 - the update path of the managed binary.
 *
 * All three were unrun because each needs a genuine older installation to
 * update *from*. The pinned fixture provides one: `CMM_FIXTURE_CLI_OLD` is the
 * cached v0.10.0 build and `CMM_FIXTURE_CLI` is the install path the extension
 * owns inside the scratch HOME. A row seeds by copying the old build over that
 * path, so the update it then drives is a real downgrade-then-update, not a
 * simulation.
 *
 * These rows run in their own suite, and therefore their own Electron launch,
 * for one reason: they mutate the single installed binary the whole scratch
 * HOME shares, and a daemon started from it outlives the window that spawned
 * it. `runTest.ts` orders the suite last and the tests restore the pinned
 * current build afterwards, so a repeated `npm run test:integration` against a
 * hand-provisioned fixture still starts from a sane installation.
 *
 * Four facts cost a failed probe run each (see the resolution of
 * smoochy/homelab-private#1943) and are honoured here:
 *
 * - The developer's own CLI on `PATH` resolves as an external install and
 *   `refuseIfExternal` then blocks the update outright. `runTest.ts` filters
 *   `.local/bin` out of the environment it hands the host.
 * - `daemon stop` returns before the process is gone, so a following start
 *   races it. Poll `daemon status` until it exits non-zero.
 * - v0.10.8 writes a `_config.db` that v0.10.0 cannot open, and its daemon then
 *   dies while still reporting itself as starting. The caches have to go with
 *   the downgrade for the fixture to resemble a real v0.10.0 user.
 * - `fs.openSync` does not block a rename on Windows: libuv opens with
 *   `FILE_SHARE_DELETE`. A `FileShare.Read` handle is the one that models a
 *   running binary - it blocks the rename and still allows execution.
 */
const INSTALLED = process.env.CMM_FIXTURE_CLI
const OLD_BINARY = process.env.CMM_FIXTURE_CLI_OLD
const HAS_FIXTURE = INSTALLED !== undefined && OLD_BINARY !== undefined

const OLD_VERSION = '0.10.0'

interface TestApi {
  panelHtmlForTests?: () => string
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function cli(args: string[]): { code: number | null; output: string } {
  const result = spawnSync(INSTALLED ?? '', args, { encoding: 'utf8', timeout: 120_000 })
  return {
    code: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  }
}

/** The installed build's own version string, read the way the extension reads it. */
function installedVersion(): string {
  const { output } = cli(['--version'])
  const match = /(\d+\.\d+\.\d+)/.exec(output)
  assert.ok(match, `could not read a version from \`--version\`: ${output}`)
  return match[1]!
}

function isNewerThan(version: string, than: string): boolean {
  const parts = (value: string): number[] => value.split('.').map((piece) => Number(piece))
  const [a, b] = [parts(version), parts(than)]
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Processes running the installed binary itself. Matched on the executable
 * path, which is inside the scratch HOME, so a developer's own daemon on the
 * same machine is never in this list.
 */
function daemonProcesses(): number[] {
  // The install path may reach us in its short form - the harness hands over a
  // scratch HOME under `ADMINI~1` - while Windows reports the long one, so a
  // string comparison against the path as given finds nothing and the kill
  // below would silently do nothing at all. Compare against both spellings.
  const paths = new Set([INSTALLED!.toLowerCase()])
  try {
    paths.add(realpathSync.native(INSTALLED!).toLowerCase())
  } catch {
    // The binary is mid-replacement; the spelling we were handed still counts.
  }

  if (process.platform !== 'win32') {
    const pids: number[] = []
    for (const path of paths) {
      const found = spawnSync('pgrep', ['-f', path], { encoding: 'utf8', timeout: 60_000 })
      pids.push(...(found.stdout ?? '').split(/\r?\n/).map((line) => Number(line.trim())))
    }
    return pids.filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  }

  const listed = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ' +
        'ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
  return (listed.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.split('|'))
    .filter(([, path]) => path !== undefined && paths.has(path.trim().toLowerCase()))
    .map(([pid]) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
}

/**
 * `daemon stop` returns before the process has actually exited - and worse,
 * `daemon status` starts answering "not running" while the process is still
 * alive and still holding every file under the scratch HOME open, which is what
 * makes the downgrade below fail with EPERM. So the signal is both: status has
 * to stop answering, and no process may still be running the installed binary.
 */
async function stopDaemon(): Promise<void> {
  cli(['daemon', 'stop'])
  let stopped = false
  for (let attempt = 0; attempt < 60 && !stopped; attempt += 1) {
    stopped = cli(['daemon', 'status']).code !== 0
    if (!stopped) await sleep(500)
  }
  assert.ok(stopped, 'the daemon was still running 30s after `daemon stop`')

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pids = daemonProcesses()
    if (pids.length === 0) return
    for (const pid of pids) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/F'], { encoding: 'utf8', timeout: 60_000 })
      } else {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone between the listing and the signal.
        }
      }
    }
    await sleep(500)
  }
  assert.fail('a process is still running the installed binary after it reported itself stopped')
}

async function startDaemon(): Promise<void> {
  cli(['daemon', 'start'])
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (cli(['daemon', 'status']).code === 0) return
    await sleep(500)
  }
  assert.fail('the daemon did not come up 30s after `daemon start`')
}

/**
 * Put the installation back to v0.10.0: stop whatever is running, overwrite the
 * managed path with the pinned old build, and clear the state the newer build
 * wrote, which the older one cannot open.
 */
/**
 * Windows refuses to remove a directory while anything still has a handle in
 * it, and a CLI call the daemon-stop did not wait for is exactly that. Retry
 * rather than fail the row on a race - but never pass on a directory that is
 * still there, since the older build cannot open the newer one's state.
 */
async function removeStale(directory: string): Promise<void> {
  let last = ''
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (err) {
      // Still held; the existence check below decides whether that mattered.
      last = err instanceof Error ? err.message : String(err)
    }
    if (!existsSync(directory)) return
    await sleep(500)
  }
  // Naming what still holds it, because "EPERM" alone sent this row round the
  // loop twice: the answer was a process the daemon-stop had not killed.
  const probe =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | Where-Object { $_.Name -like "*codebase-memory*" } | ' +
              'ForEach-Object { "$($_.ProcessId) $($_.ExecutablePath)" }',
          ],
          { encoding: 'utf8', timeout: 60_000 },
        )
      : spawnSync('pgrep', ['-al', 'codebase-memory'], { encoding: 'utf8', timeout: 60_000 })
  const holders = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim()
  const survivors = existsSync(directory)
    ? readdirSync(directory, { recursive: true }).map(String).join(', ')
    : '(gone)'
  assert.fail(
    `${directory} could not be removed, so the downgrade would not resemble a v0.10.0 user.\n` +
      `Last error: ${last || '(none)'}\n` +
      `Still present: ${survivors}\n` +
      `Process probe (exit ${String(probe.status)}${probe.error ? `, ${probe.error.message}` : ''}): ` +
      `${holders || '(no output)'}`,
  )
}

async function seedOldInstall(): Promise<void> {
  await stopDaemon()
  copyFileSync(OLD_BINARY!, INSTALLED!)
  const home = homedir()
  // Only the CLI's own state, never `appdata/Local` as a whole: the scratch
  // HOME is a real LOCALAPPDATA for every process the tests spawn, and Windows
  // itself writes there - a run found PowerShell startup profiles and an NVIDIA
  // shader cache in it, which is what made the wholesale removal fail with
  // EPERM forever rather than on a race.
  const localAppData = join(home, 'appdata', 'Local')
  const stale = [join(home, '.cache', 'codebase-memory-mcp')]
  if (existsSync(localAppData)) {
    for (const entry of readdirSync(localAppData)) {
      if (/^(cbm-daemon|codebase-memory)/i.test(entry)) stale.push(join(localAppData, entry))
    }
  }
  for (const directory of stale) {
    await removeStale(directory)
  }
  assert.equal(installedVersion(), OLD_VERSION, 'seeding did not leave v0.10.0 installed')
}

/**
 * The tail of the extension's own log. `betterCmm.updateBinary` reports every
 * refusal through a notification, which a test cannot read, and returns
 * normally - so without this an assertion could only say that the version did
 * not move, never why.
 */
function extensionLog(): string {
  const userData = process.env.AUTOTEST_USER_DATA_DIR
  if (userData === undefined) return '(no AUTOTEST_USER_DATA_DIR, so no log path is known)'
  const path = join(
    userData,
    'User',
    'globalStorage',
    EXTENSION_ID.toLowerCase(),
    'logs',
    'better-cmm.log',
  )
  if (!existsSync(path)) return `(no log at ${path})`
  return readFileSync(path, 'utf8').split(/\r?\n/).slice(-25).join('\n')
}

/** Activate the extension and let it resolve the installation currently on disk. */
async function refreshedApi(): Promise<TestApi | undefined> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID)
  await extension?.activate()
  await vscode.commands.executeCommand('betterCmm.refresh')
  return extension?.exports as TestApi | undefined
}

describe('updating the managed binary', () => {
  before(async function () {
    if (!HAS_FIXTURE) {
      this.skip()
    }
    this.timeout(900_000)
    // The refresh timer launches the CLI while the panel is visible (row C16),
    // and a call in flight holds the very files the downgrade has to remove.
    // A hidden panel launches nothing, so the suite works on a quiet store.
    await vscode.commands.executeCommand('workbench.action.closeSidebar')
    // The profile is shared with the earlier passes, and one of them leaves
    // `binarySource` on `external`. The extension then refuses every update as
    // "the active binary is not managed", which is correct behaviour and the
    // wrong premise for these rows: they are about the binary the extension
    // owns. Say so explicitly rather than inheriting whatever ran before.
    await vscode.workspace
      .getConfiguration('betterCmm')
      .update('binarySource', 'managed', vscode.ConfigurationTarget.Global)

    // The extension only updates an installation it recorded installing, and
    // the harness provisioned this one behind its back - so without a real
    // Setup the update refuses with "no managed binary is installed yet". Run
    // it once here: it installs the current release into the very path the
    // fixture uses and records the ownership the rows depend on. Each row then
    // downgrades that installation to v0.10.0, which is exactly the user this
    // row is about - someone who installed through the extension a while ago.
    await refreshedApi()
    await vscode.commands.executeCommand('betterCmm.runSetup')
    assert.ok(existsSync(INSTALLED!), 'setup did not leave a managed binary behind')
  })

  after(async function () {
    if (!HAS_FIXTURE) return
    this.timeout(120_000)
    // Leave no daemon holding the installation open. Which build is installed
    // afterwards depends on the last row that ran - the rollback row ends on
    // v0.10.0 by design - and both are working installations that the next
    // run reseeds anyway; `scripts/autotest.mjs` discards the scratch HOME
    // between runs regardless.
    await stopDaemon()
  })

  it('completes an update from a real older build while its server runs', async function () {
    this.timeout(600_000)
    await seedOldInstall()
    await startDaemon()

    const api = await refreshedApi()
    await vscode.commands.executeCommand('betterCmm.updateBinary')

    // The update downloads the current release, which is whatever GitHub calls
    // latest today - never the pin. Asserting a fixed tag here would go red the
    // day upstream releases, so the assertion is the one the row actually
    // makes: the installation moved on from the old build.
    let updated = OLD_VERSION
    for (let attempt = 0; attempt < 240 && !isNewerThan(updated, OLD_VERSION); attempt += 1) {
      await sleep(1_000)
      updated = installedVersion()
    }
    assert.ok(
      isNewerThan(updated, OLD_VERSION),
      `the installed binary is still ${updated} after the update.\n${extensionLog()}`,
    )

    // The panel renders only while it is visible, and this suite keeps it
    // hidden so the refresh timer cannot touch the store mid-downgrade. Show it
    // for the one assertion that reads what the user would see, then hide it.
    await vscode.commands.executeCommand('betterCmm.panel.focus')
    const version = new RegExp(updated.replaceAll('.', '\\.'))
    let html = ''
    for (let attempt = 0; attempt < 60 && !version.test(html); attempt += 1) {
      await sleep(500)
      html = api?.panelHtmlForTests?.() ?? ''
    }
    await vscode.commands.executeCommand('workbench.action.closeSidebar')
    assert.match(html, version, 'the panel does not report the version that is now installed')
    assert.equal(cli(['cli', '--json', 'list_projects']).code, 0, 'the updated CLI does not run')
  })

  it('stops a 0.10.x daemon as part of the update', async function () {
    this.timeout(600_000)
    await seedOldInstall()
    await startDaemon()
    assert.equal(cli(['daemon', 'status']).code, 0, 'the old daemon is not running before the update')

    await refreshedApi()
    await vscode.commands.executeCommand('betterCmm.updateBinary')

    let updated = OLD_VERSION
    for (let attempt = 0; attempt < 240 && !isNewerThan(updated, OLD_VERSION); attempt += 1) {
      await sleep(1_000)
      updated = installedVersion()
    }
    assert.ok(
      isNewerThan(updated, OLD_VERSION),
      `the update did not install (still ${updated}).\n${extensionLog()}`,
    )

    // A daemon from the old build refuses every client of the new one, so the
    // row is only green when it is gone - and then when a fresh call works.
    assert.notEqual(
      cli(['daemon', 'status']).code,
      0,
      'the 0.10.x daemon survived the update, so every call against the new build would fail',
    )
    assert.equal(cli(['cli', '--json', 'list_projects']).code, 0, 'the updated CLI does not run')
  })

  // Windows only, and registered rather than skipped: a `pending` test makes
  // the suite unclean for the autotest harness, so on macOS and Linux this row
  // is absent from the tree and disclosed as residue instead of faked green.
  // A read-share handle is a Windows file-locking behaviour; POSIX does not
  // block a rename on an open handle at all, so there is nothing to port.
  if (process.platform === 'win32') {
    it('rolls back and leaves the older installation intact when the target is locked', async function () {
      this.timeout(600_000)
      await seedOldInstall()
      const before = sha256(INSTALLED!)
      const size = statSync(INSTALLED!).size

      // FileShare.Read: blocks the rename the update needs, still allows the
      // pre-update version read to execute the file.
      const holder: ChildProcess = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$f=[System.IO.File]::Open('${INSTALLED!.replaceAll("'", "''")}',` +
            `'Open','Read','Read'); Start-Sleep -Seconds 600; $f.Close()`,
        ],
        { stdio: 'ignore' },
      )
      // The handle has to exist before the update starts, or the rename simply
      // succeeds and the rollback branch never runs.
      await sleep(3_000)

      try {
        await refreshedApi()
        await vscode.commands.executeCommand('betterCmm.updateBinary')
        // Long enough for a 37 MB download plus the failed rename; the update
        // fails, so there is no state change to poll for.
        await sleep(120_000)

        assert.equal(sha256(INSTALLED!), before, 'the locked installation was modified')
        assert.equal(statSync(INSTALLED!).size, size, 'the locked installation changed size')
        assert.equal(installedVersion(), OLD_VERSION, 'the locked installation is no longer v0.10.0')
        for (const leftover of [`${INSTALLED!}.new`, `${INSTALLED!}.old`]) {
          assert.equal(existsSync(leftover), false, `the failed update left ${leftover} behind`)
        }
      } finally {
        holder.kill()
      }
    })
  }
})
