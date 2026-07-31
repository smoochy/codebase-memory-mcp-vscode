import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

async function main(): Promise<void> {
  // The extension manifest lives at the repo root; compiled test entry
  // point lives under out/ once tsc has run (see npm run compile:test).
  const extensionDevelopmentPath = resolve(__dirname, '../../..')
  const extensionTestsPath = resolve(__dirname, './suite/index')

  try {
    // Launch the Electron binary directly. bin/code.cmd is the CLI wrapper: it
    // spawns VS Code detached and returns straight away, so the run reports
    // success without ever loading extensionTestsPath.
    const executable = await downloadAndUnzipVSCode()

    // ELECTRON_RUN_AS_NODE makes any Electron binary run as plain Node, so
    // Code.exe parses VS Code's own flags as Node options and exits 9 with
    // "bad option: --extensionTestsPath" before a single test runs. Some
    // toolchains export it globally, so clear it here rather than expecting
    // every caller to.
    delete process.env.ELECTRON_RUN_AS_NODE

    // The host's stdout does not reliably reach the parent process, so the
    // suite reports its outcome through this file instead.
    const resultFile = resolve(
      extensionDevelopmentPath,
      '.vscode-test/integration-result.json',
    )
    rmSync(resultFile, { force: true })

    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
    })

    if (!existsSync(resultFile)) {
      throw new Error(
        'the test host exited without reporting a result — no tests were run',
      )
    }

    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as {
      files: number
      passing: number
      failing: number
      failureMessages?: string[]
    }

    console.log(
      `integration: ${String(result.passing)} passing, ${String(result.failing)} failing ` +
        `(${String(result.files)} file(s))`,
    )
    for (const message of result.failureMessages ?? []) {
      console.error(`  ${message}`)
    }
    if (result.failing > 0 || result.passing === 0) {
      throw new Error('integration tests did not pass')
    }
  } catch (err) {
    console.error('Integration tests failed to run', err)
    process.exit(1)
  }
}

void main()
