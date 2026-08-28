#!/usr/bin/env node
// One unattended verification pass over the extension.
//
// This is deliberately stateless: one invocation runs every stage once, writes
// one JSON record plus one Markdown summary, and exits. Rounds, the git tree
// hash that gates a round, the per-row fix budget and the throwaway
// `autotest/<run-id>` branch all belong to the agent loop that calls this - not
// in here. That split is what keeps this runnable by hand, and testable on its
// own, without granting it any authority to change the code it is judging.
//
// Node rather than a shell script: the repository already targets Windows,
// macOS and Linux, and .github/workflows/ci.yaml already needs a `shell: bash`
// plus a `RUNNER_OS` branch to paper over the difference. A second shell script
// would duplicate exactly that trap.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acquire,
  classifyAcquisitionError,
  provision,
  readPin,
} from './cli-fixture.mjs'
import { checkRows } from './check-rows.mjs'
import { residue as rowResidue } from './manual-testing-rows.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A run identifier the caller can pin, so the agent loop can name a round's
// artifacts before the run produces them.
const runId = process.env.AUTOTEST_RUN_ID ?? new Date().toISOString().replace(/[:.]/gu, '-')
const outDir = join(repoRoot, '.autotest', runId)

// A profile per round, not per run: a reused Electron host accumulates
// extension-host cache and settings, so a round-N pass would not reproduce on a
// clean install. The Electron download cache under .vscode-test stays shared -
// that is a binary, not state.
//
// The directory name is a short hash rather than the run id, and on macOS it
// sits under /tmp rather than the per-user temp directory. Electron opens a
// unix domain socket inside user-data, and a unix socket path is limited to
// 103 bytes on macOS; the runner's own tmpdir is `/var/folders/<2>/<26>/T/`,
// which spends 49 of those before the profile name is added at all. Exceeding
// the limit fails the listen with EINVAL and the host dies before a single
// test runs - which the harness can only report as `error`.
const profileBase = process.platform === 'darwin' ? '/tmp' : tmpdir()
const profileKey = createHash('sha256').update(runId).digest('hex').slice(0, 8)
const profileDir = join(profileBase, `autotest-${profileKey}`)
const userDataDir = join(profileDir, 'user-data')
const extensionsDir = join(profileDir, 'extensions')

// The scratch HOME is a sibling of the profile, not a child of it. The CLI puts
// its own state under `<home>/.cache/codebase-memory-mcp`, so nesting it inside
// the profile would spend the macOS socket-path budget above twice over on one
// path. Same short-hash-under-/tmp shape, its own budget.
const scratchHome = join(profileBase, `autotest-${profileKey}-home`)

/** Run one command, capturing everything. Never throws. */
function exec(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    // npm and npx are shell wrappers on Windows; without this they are not
    // resolvable as executables.
    shell: process.platform === 'win32',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return { code: result.status ?? 1, output, spawnError: result.error }
}

const units = []

function record(id, status, detail, output = '') {
  const captured = output.slice(-4000)
  units.push({ id, status, detail, output: captured })
  console.log(`${status.toUpperCase().padEnd(8)} ${id}${detail ? ` - ${detail}` : ''}`)
  // A unit that did not pass has to say why in the log too, not only in the
  // JSON record. The report is a file, and a file can fail to reach the reader
  // - an artifact upload that drops it leaves the log as the only account of
  // the run, and a log that names a failure without its output cannot be
  // diagnosed at all.
  if (status !== 'pass' && status !== 'skipped' && captured) {
    for (const line of captured.split('\n')) {
      console.log(`  | ${line}`)
    }
  }
}

// The stages, in order. `build` and `compile:test` are the only hard stops:
// without dist/ and out/ nothing downstream can run at all, so continuing would
// only produce a wall of `error` saying nothing the build failure did not
// already say. Every other stage runs regardless of what failed before it,
// because one report covering every stage is what lets a fix round address more
// than one defect.
//
// The commands below deliberately bypass the npm scripts that wrap them
// (`test:unit`, `test:package`, `test:integration`), because each of those
// re-runs `build` and `compile:test` first. Invoked through the scripts, a
// single pass would rebuild four times over, and a bounded loop pays that on
// every round.
const stages = [
  { id: 'build', hardStop: true, run: () => exec('npm', ['run', 'build']) },
  { id: 'compile:test', hardStop: true, run: () => exec('npm', ['run', 'compile:test']) },
  { id: 'vsix', run: () => exec('npm', ['run', 'package']) },
  { id: 'lint', run: () => exec('npm', ['run', 'lint']) },
  { id: 'unit', run: () => exec('npx', ['mocha']) },
  {
    id: 'package',
    run: () => exec('npx', ['mocha', '--no-config', '--spec', 'out/test/package/**/*.test.js']),
  },
]

/**
 * Remove a scratch directory without ever failing the run.
 *
 * A CLI invocation leaves a daemon behind that keeps files in the scratch home
 * open, so removing it races that process and answers EPERM on Windows often
 * enough to matter - and a teardown that threw would lose both the report and
 * the exit code after every stage had already passed. Each directory is named
 * after the run, so what survives is stale rather than reused.
 */
function discard(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    console.log(`note: ${directory} could not be removed (${err.code ?? err.message})`)
  }
}

mkdirSync(outDir, { recursive: true })
discard(profileDir)
mkdirSync(userDataDir, { recursive: true })
mkdirSync(extensionsDir, { recursive: true })
discard(scratchHome)
mkdirSync(scratchHome, { recursive: true })

let halted = null

for (const stage of stages) {
  if (halted) {
    // `error`, never `skipped`. In the loop contract `skipped` means a unit
    // that was deliberately left to a human, and it counts towards a clean
    // run - so a stage that simply never executed must not borrow that word,
    // or a broken build would report as green with most of its units silently
    // unexamined.
    record(stage.id, 'error', `not run: ${halted} failed`)
    continue
  }
  const { code, output, spawnError } = stage.run()
  if (spawnError) {
    record(stage.id, 'error', spawnError.message, output)
    if (stage.hardStop) halted = stage.id
    continue
  }
  record(stage.id, code === 0 ? 'pass' : 'fail', `exit ${String(code)}`, output)
  if (code !== 0 && stage.hardStop) halted = stage.id
}

// The pinned CLI fixture, acquired before the Electron host rather than from
// inside a test. A download is not something a fix round can repair, so it must
// never reach mocha as a red test: an unreachable release leaves the rows that
// need a real binary as named residue and the rest of the run continues.
//
// A checksum mismatch is not that. `skipped` is reserved for work deliberately
// left to a human, and a pinned asset whose digest no longer matches is either
// a corrupted cache or a substituted release - reporting it as residue would be
// the exact false green this harness exists to prevent.
const fixtureEnv = {}
let fixtureResidue = null

if (!halted) {
  try {
    const pin = readPin()
    const platform = process.platform
    const arch = process.arch
    const current = await acquire({ pin, entry: 'current', platform, arch, env: process.env })
    const old = await acquire({ pin, entry: 'old', platform, arch, env: process.env })
    const installed = provision(current.path, scratchHome, platform)

    fixtureEnv.CMM_FIXTURE_HOME = scratchHome
    fixtureEnv.CMM_FIXTURE_CLI = installed
    fixtureEnv.CMM_FIXTURE_TAG = current.tag
    // The older release stays in the cache rather than the scratch home: both
    // entries carry the same file name, so only one of them can occupy the
    // install path a row is updating *from*.
    fixtureEnv.CMM_FIXTURE_CLI_OLD = old.path
    fixtureEnv.CMM_FIXTURE_TAG_OLD = old.tag

    record(
      'cli-fixture',
      'pass',
      `${current.tag} at ${installed}, ${old.tag} cached${current.cached && old.cached ? ' (both from cache)' : ''}`,
    )
  } catch (err) {
    const kind = classifyAcquisitionError(err)
    fixtureResidue =
      `The rows that need a real pinned CLI binary did not run: ${kind} failure - ${err.message}`
    record(
      'cli-fixture',
      kind === 'network' ? 'skipped' : 'fail',
      `${kind}: ${err.message}`,
      String(err.stack ?? ''),
    )
  }
}

// Preflight, empirical rather than structural: invoke the pinned CLI once with
// the scratch HOME already in place and require exit 0. It tests the exact
// thing the fixture rows depend on, runs unchanged on both operating systems,
// and survives a future CLI deriving its paths differently - none of which a
// Windows-only DACL inspector would.
//
// A failed preflight is a hard stop, not a test failure. It means the machine
// is misconfigured, and a machine problem reported as a red test would be
// handed to a fix round that cannot possibly repair it.
if (!halted && fixtureEnv.CMM_FIXTURE_CLI) {
  const preflight = spawnSync(fixtureEnv.CMM_FIXTURE_CLI, ['cli', '--json', 'list_projects'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: scratchHome, USERPROFILE: scratchHome },
  })
  const output = `${preflight.stdout ?? ''}${preflight.stderr ?? ''}`.trim()
  if (preflight.error || preflight.status !== 0) {
    record(
      'cli-preflight',
      'error',
      preflight.error
        ? preflight.error.message
        : `the pinned CLI exited ${String(preflight.status)} under the scratch HOME`,
      `${output}\n\nRemediation: the scratch HOME is rejected by the CLI's own coordination check. ` +
        `On Windows this is caused by foreign modify-and-delete entries on %LOCALAPPDATA%\\Temp; ` +
        `remove them once by hand with Get-Acl / RemoveAccessRuleSpecific / Set-Acl. ` +
        `The run does not repair machine configuration.`,
    )
    halted = 'cli-preflight'
  } else {
    record('cli-preflight', 'pass', `exit 0 under ${scratchHome}`)
  }
} else if (!halted) {
  record('cli-preflight', 'skipped', 'no fixture to preflight')
}

// The integration tier is two Electron launches with opposite hosts, and each
// carries its own verdict. Rolling them into one stage would mean a failure in
// the `default` suite leaves the `git` suite reported as nothing at all -
// indistinguishable from a suite that passed.
const suites = ['default', 'git', 'workspace']

if (halted) {
  for (const suite of suites) {
    record(`integration:${suite}`, 'error', `not run: ${halted} failed`)
  }
} else {
  const { code, output, spawnError } = exec('node', ['./out/test/integration/runTest.js'], {
    AUTOTEST_USER_DATA_DIR: userDataDir,
    AUTOTEST_EXTENSIONS_DIR: extensionsDir,
    ...fixtureEnv,
  })
  for (const suite of suites) {
    const resultFile = join(repoRoot, '.vscode-test', `integration-result-${suite}.json`)
    if (!existsSync(resultFile)) {
      // No result file means the host never reported. That is inconclusive,
      // never a pass - the whole reason the suite writes a file rather than
      // trusting stdout.
      record(
        `integration:${suite}`,
        'error',
        spawnError ? spawnError.message : 'the test host reported no result',
        output,
      )
      continue
    }
    let result
    try {
      result = JSON.parse(readFileSync(resultFile, 'utf8'))
    } catch (err) {
      record(`integration:${suite}`, 'error', `unreadable result file: ${err.message}`, output)
      continue
    }
    const detail =
      `${String(result.passing)} passing, ${String(result.failing)} failing, ` +
      `${String(result.pending ?? 0)} pending`
    // Zero passing tests is a harness failure dressed as a green run, and a
    // pending test is a row that quietly did not run. Neither is a pass.
    const clean = result.failing === 0 && result.passing > 0 && (result.pending ?? 0) === 0
    record(
      `integration:${suite}`,
      clean ? 'pass' : 'fail',
      detail,
      [...(result.failureMessages ?? []), output].join('\n'),
    )
  }
  if (code !== 0 && units.every((unit) => unit.status === 'pass')) {
    // The runner disagreed with every per-suite record. Report the discrepancy
    // rather than letting the greener of the two readings win.
    record(
      'integration:runner',
      'error',
      `runner exited ${String(code)} with no failing suite`,
      output,
    )
  }
}

// The row registry, checked last because part of it reads the result files the
// integration stage just wrote. A halted run leaves those files stale - from
// whichever run wrote them last - so the check is not attempted at all rather
// than answered from a previous run's evidence.
if (halted) {
  record('rows', 'error', `not run: ${halted} failed`)
} else {
  try {
    const result = checkRows()
    record('rows', result.status, result.detail, result.output)
  } catch (err) {
    record('rows', 'error', `the row checks threw: ${err.message}`, String(err.stack ?? ''))
  }
}

discard(profileDir)
discard(scratchHome)

/**
 * The residue line, or an honest explanation of why there is none.
 *
 * An unreadable registry already failed the `rows` unit above; it must not also
 * throw here, where it would take the report and the exit code with it.
 */
function rowResidueOrExplanation() {
  try {
    return rowResidue()
  } catch (err) {
    return `The residue could not be derived from docs/manual-testing-rows.json: ${err.message}`
  }
}

// Exit code vocabulary, per the loop contract: 0 is a clean run, 1 says the
// extension is broken, 2 says the run could not answer the question. Keeping
// those apart is the point - an escalation must never read as a failure, and
// neither may read as a pass.
const escalation = units.some((unit) => ['error', 'flaky', 'exhausted'].includes(unit.status))
const failure = units.some((unit) => unit.status === 'fail')
const exitCode = escalation ? 2 : failure ? 1 : 0

const report = {
  runId,
  finishedAt: new Date().toISOString(),
  platform: process.platform,
  exitCode,
  units,
  // The rows of docs/MANUAL-TESTING.md this run did not cover, derived from
  // docs/manual-testing-rows.json rather than written out here: when a row
  // changes status, this line changes with it and nobody has to remember. A run
  // whose fixture happened to work must still disclose what it never checked,
  // or a green report grows quieter the better it goes.
  residue: [
    rowResidueOrExplanation(),
    ...(fixtureResidue === null ? [] : [fixtureResidue]),
  ].join('\n\n'),
}

writeFileSync(join(outDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`)

const markdown = [
  `# autotest ${runId}`,
  '',
  `Platform: ${process.platform}. Exit code: ${String(exitCode)}.`,
  '',
  '| Unit | Status | Detail |',
  '| --- | --- | --- |',
  ...units.map((unit) => `| ${unit.id} | ${unit.status} | ${unit.detail} |`),
  '',
  '## Not checked by this run',
  '',
  report.residue,
  '',
].join('\n')

writeFileSync(join(outDir, 'report.md'), markdown)

// The residue goes to the log as well as into the report: the log is what a
// person watching the run reads, and a run that only files its uncovered rows
// in an artifact reads as if it covered everything.
console.log(`\nnot checked by this run:\n${report.residue}`)
console.log(`\nreport: ${join(outDir, 'report.md')}`)
process.exit(exitCode)
