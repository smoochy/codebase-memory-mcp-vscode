import { readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Mocha from 'mocha'

/**
 * The host runs behind bin/code.cmd via a shell, so its stdout never reaches
 * the parent process and a run that executed nothing looks exactly like a run
 * that passed. Write the outcome where runTest.ts can read it instead.
 */
// __dirname is out/test/integration/suite, so four levels up is the repo root.
const DEFAULT_RESULT_FILE = resolve(
  __dirname,
  '../../../../.vscode-test/integration-result-default.json',
)
// runTest.ts names one file per suite; the fallback only matters when the
// entry point is launched by hand.
const RESULT_FILE = process.env.CBM_RESULT_FILE ?? DEFAULT_RESULT_FILE

function writeResult(result: Record<string, unknown>): void {
  try {
    writeFileSync(RESULT_FILE, JSON.stringify(result))
  } catch {
    // Reporting must never mask the actual test outcome.
  }
}

function collectTestFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(full))
    } else if (entry.name.endsWith('.test.js')) {
      files.push(full)
    }
  }
  return files
}

/** Entry point the VS Code test host loads (see runTest.ts). */
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: false, timeout: 20_000 })
  // Each named directory holds the tests that need their own host: `git` needs
  // the built-in git extension running, `workspace` needs a folder open,
  // `installed` needs the packaged build rather than the checkout. They
  // are separate launches rather than part of the default one, so the default
  // pass keeps `--disable-extensions` and an empty window. Which set to run
  // comes from runTest.ts.
  const namedSuites = ['git', 'workspace', 'update', 'installed'] as const
  const suiteRoots = new Map(namedSuites.map((name) => [name, resolve(__dirname, `../${name}`)]))
  const suite = process.env.CBM_TEST_SUITE ?? 'default'
  const namedRoot = suiteRoots.get(suite as (typeof namedSuites)[number])
  const testsRoot = namedRoot ?? resolve(__dirname, '..')

  const files = collectTestFiles(testsRoot).filter(
    (file) =>
      namedRoot !== undefined || ![...suiteRoots.values()].some((root) => file.startsWith(root)),
  )
  for (const file of files) {
    mocha.addFile(file)
  }

  // Zero discovered files is a harness failure, not a pass.
  if (files.length === 0) {
    writeResult({
      files: 0,
      passing: 0,
      failing: 0,
      pending: 0,
      tests: [],
      error: 'no test files discovered',
    })
    throw new Error(`no integration test files found under ${testsRoot}`)
  }

  return new Promise((resolvePromise, reject) => {
    const failureMessages: string[] = []
    // Every test that ran, by full title and outcome. Aggregate counts alone
    // cannot answer "did this checklist row run, and what did it say" - a row
    // that stops being discovered, or gets marked pending, just makes a count
    // one smaller with nothing naming what disappeared. The autotest harness
    // reads these titles to map tests onto checklist rows.
    const tests: { title: string; state: string }[] = []
    const runner = mocha.run((failures) => {
      writeResult({
        files: files.length,
        passing: runner.stats?.passes ?? 0,
        failing: failures,
        pending: runner.stats?.pending ?? 0,
        tests,
        failureMessages,
      })
      if (failures > 0) {
        reject(new Error(`${String(failures)} integration test(s) failed.`))
      } else {
        resolvePromise()
      }
    })
    runner.on('pending', (test) => {
      tests.push({ title: test.fullTitle(), state: 'pending' })
    })
    runner.on('test end', (test) => {
      tests.push({ title: test.fullTitle(), state: test.state ?? 'unknown' })
    })
    runner.on('fail', (test, err: Error) => {
      failureMessages.push(`${test.fullTitle()}: ${err.message}`)
    })
  })
}
