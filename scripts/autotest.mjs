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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A run identifier the caller can pin, so the agent loop can name a round's
// artifacts before the run produces them.
const runId = process.env.AUTOTEST_RUN_ID ?? new Date().toISOString().replace(/[:.]/gu, '-')
const outDir = join(repoRoot, '.autotest', runId)

// A profile per round, not per run: a reused Electron host accumulates
// extension-host cache and settings, so a round-N pass would not reproduce on a
// clean install. The Electron download cache under .vscode-test stays shared -
// that is a binary, not state.
const profileDir = join(tmpdir(), `autotest-profile-${runId}`)
const userDataDir = join(profileDir, 'user-data')
const extensionsDir = join(profileDir, 'extensions')

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

mkdirSync(outDir, { recursive: true })
rmSync(profileDir, { recursive: true, force: true })
mkdirSync(userDataDir, { recursive: true })
mkdirSync(extensionsDir, { recursive: true })

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

// The integration tier is two Electron launches with opposite hosts, and each
// carries its own verdict. Rolling them into one stage would mean a failure in
// the `default` suite leaves the `git` suite reported as nothing at all -
// indistinguishable from a suite that passed.
const suites = ['default', 'git']

if (halted) {
  for (const suite of suites) {
    record(`integration:${suite}`, 'error', `not run: ${halted} failed`)
  }
} else {
  const { code, output, spawnError } = exec('node', ['./out/test/integration/runTest.js'], {
    AUTOTEST_USER_DATA_DIR: userDataDir,
    AUTOTEST_EXTENSIONS_DIR: extensionsDir,
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

rmSync(profileDir, { recursive: true, force: true })

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
  // The rows of docs/MANUAL-TESTING.md are not covered by this run yet. Naming
  // that here is not decoration: a report that silently omits what it did not
  // check is exactly the false green this harness exists to prevent.
  residue: 'No manual-checklist rows are automated yet; the permanent human residue is undecided.',
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

console.log(`\nreport: ${join(outDir, 'report.md')}`)
process.exit(exitCode)
