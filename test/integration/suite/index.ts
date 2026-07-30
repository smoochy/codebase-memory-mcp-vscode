import { readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Mocha from 'mocha'

/**
 * The host runs behind bin/code.cmd via a shell, so its stdout never reaches
 * the parent process and a run that executed nothing looks exactly like a run
 * that passed. Write the outcome where runTest.ts can read it instead.
 */
// __dirname is out/test/integration/suite, so four levels up is the repo root.
const RESULT_FILE = resolve(__dirname, '../../../../.vscode-test/integration-result.json')

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
  const testsRoot = resolve(__dirname, '..')

  const files = collectTestFiles(testsRoot)
  for (const file of files) {
    mocha.addFile(file)
  }

  // Zero discovered files is a harness failure, not a pass.
  if (files.length === 0) {
    writeResult({ files: 0, passing: 0, failing: 0, error: 'no test files discovered' })
    throw new Error(`no integration test files found under ${testsRoot}`)
  }

  return new Promise((resolvePromise, reject) => {
    const failureMessages: string[] = []
    const runner = mocha.run((failures) => {
      writeResult({
        files: files.length,
        passing: runner.stats?.passes ?? 0,
        failing: failures,
        failureMessages,
      })
      if (failures > 0) {
        reject(new Error(`${String(failures)} integration test(s) failed.`))
      } else {
        resolvePromise()
      }
    })
    runner.on('fail', (test, err: Error) => {
      failureMessages.push(`${test.fullTitle()}: ${err.message}`)
    })
  })
}
