import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

interface SuiteResult {
  files: number
  passing: number
  failing: number
  pending?: number
  tests?: { title: string; state: string }[]
  failureMessages?: string[]
  error?: string
}

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

    // --no-sandbox on Linux: the CI runner images deny unprivileged user
    // namespaces, so Electron's sandbox helper cannot start and the test host
    // dies before it loads a single test.
    const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : []

    // The autotest harness gives each of its rounds a fresh profile, so that a
    // round-N pass cannot be inherited from extension-host state left behind by
    // round N-1. Unset means the default: let test-electron pick its own temp
    // profile, which keeps `npm run test:integration` working standalone.
    const profile: string[] = []
    if (process.env.AUTOTEST_USER_DATA_DIR) {
      profile.push(`--user-data-dir=${process.env.AUTOTEST_USER_DATA_DIR}`)
    }
    if (process.env.AUTOTEST_EXTENSIONS_DIR) {
      profile.push(`--extensions-dir=${process.env.AUTOTEST_EXTENSIONS_DIR}`)
    }

    // The scratch HOME the autotest harness provisioned the pinned CLI into.
    //
    // `runTests()` has no environment option of its own; `extensionTestsEnv` is
    // merged over `process.env` and becomes the spawned Electron process's
    // environment, so it is the only way to reach the extension host at all.
    // Both variables are set because `homedir()` reads `USERPROFILE` on Windows
    // and `HOME` everywhere else - passing one of them leaves the child on the
    // real profile on the other operating system, and the isolation would
    // silently do nothing while every test still passed.
    const fixtureEnv: Record<string, string> = {}
    if (process.env.CMM_FIXTURE_HOME) {
      fixtureEnv.HOME = process.env.CMM_FIXTURE_HOME
      fixtureEnv.USERPROFILE = process.env.CMM_FIXTURE_HOME
    }
    for (const key of ['CMM_FIXTURE_CLI', 'CMM_FIXTURE_CLI_OLD', 'CMM_FIXTURE_TAG', 'CMM_FIXTURE_TAG_OLD']) {
      const value = process.env[key]
      if (value !== undefined) {
        fixtureEnv[key] = value
      }
    }

    // Two launches, because the suites need opposite hosts. The default one
    // keeps `--disable-extensions`, which is what makes it reproducible. The
    // `git` suite needs the built-in git extension actually running, since the
    // behaviour it guards - never registering an indexed project as a
    // repository - cannot be observed while that extension is disabled.
    const passes: { name: string; suite: string; launchArgs: string[] }[] = [
      {
        name: 'integration',
        suite: 'default',
        launchArgs: ['--disable-extensions', ...sandbox, ...profile],
      },
      { name: 'integration (git)', suite: 'git', launchArgs: [...sandbox, ...profile] },
      // Checklist row B5 asks what happens when a repository is open: the
      // workspace must never list itself as an indexed project. The default
      // pass runs on an empty window and cannot see that at all. This repo's
      // own checkout is the folder - a real repository that already exists, so
      // the row costs no fixture.
      {
        name: 'integration (workspace)',
        suite: 'workspace',
        launchArgs: ['--disable-extensions', ...sandbox, ...profile, extensionDevelopmentPath],
      },
    ]

    // Both passes always run. A failing `default` pass used to abort before the
    // `git` pass launched, which left every test in that suite with no verdict
    // at all - indistinguishable, to a reader or to the autotest harness, from
    // a suite that passed.
    let failed = false

    for (const pass of passes) {
      // One result file per suite, so a later pass cannot overwrite the record
      // an earlier one left behind.
      const resultFile = resolve(
        extensionDevelopmentPath,
        `.vscode-test/integration-result-${pass.suite}.json`,
      )
      rmSync(resultFile, { force: true })

      try {
        await runTests({
          vscodeExecutablePath: executable,
          extensionDevelopmentPath,
          extensionTestsPath,
          launchArgs: pass.launchArgs,
          extensionTestsEnv: {
            ...fixtureEnv,
            CBM_TEST_SUITE: pass.suite,
            CBM_RESULT_FILE: resultFile,
          },
        })
      } catch (err) {
        // The host exiting non-zero is the normal signal for a failing suite;
        // the result file below is what says which tests failed.
        console.error(`${pass.name}: test host exited non-zero`, err)
        failed = true
      }

      if (!existsSync(resultFile)) {
        console.error(`${pass.name}: the test host exited without reporting a result`)
        failed = true
        continue
      }

      const result = JSON.parse(readFileSync(resultFile, 'utf8')) as SuiteResult

      console.log(
        `${pass.name}: ${String(result.passing)} passing, ${String(result.failing)} failing, ` +
          `${String(result.pending ?? 0)} pending (${String(result.files)} file(s))`,
      )
      for (const message of result.failureMessages ?? []) {
        console.error(`  ${message}`)
      }
      if (result.failing > 0 || result.passing === 0) {
        failed = true
      }
    }

    if (failed) {
      throw new Error('integration tests did not pass')
    }
  } catch (err) {
    console.error('Integration tests failed to run', err)
    process.exit(1)
  }
}

void main()
