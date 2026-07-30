import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import Mocha from 'mocha'

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
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 20_000 })
  const testsRoot = resolve(__dirname, '..')

  for (const file of collectTestFiles(testsRoot)) {
    mocha.addFile(file)
  }

  return new Promise((resolvePromise, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${String(failures)} integration test(s) failed.`))
      } else {
        resolvePromise()
      }
    })
  })
}
