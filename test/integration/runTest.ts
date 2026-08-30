import { downloadAndUnzipVSCode, runTests, runVSCodeCommand } from '@vscode/test-electron'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'

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

    // A developer's own CLI on PATH defeats the scratch HOME entirely: the
    // extension resolves it as an external install and `refuseIfExternal` then
    // blocks setup and update, so every fixture row fails for a reason that has
    // nothing to do with the extension. `~/.local/bin` is where the CLI's own
    // installer puts it. Only filtered when the run brought a scratch HOME,
    // since without one there is nothing to protect.
    if (process.env.CMM_FIXTURE_HOME && process.env.PATH) {
      fixtureEnv.PATH = process.env.PATH.split(delimiter)
        .filter((entry) => !/[\\/]\.local[\\/]bin[\\/]?$/.test(entry))
        .join(delimiter)
    }

    // Two launches, because the suites need opposite hosts. The default one
    // keeps `--disable-extensions`, which is what makes it reproducible. The
    // `git` suite needs the built-in git extension actually running, since the
    // behaviour it guards - never registering an indexed project as a
    // repository - cannot be observed while that extension is disabled.
    // `developmentPath` never points at this checkout for the installed pass,
    // and that is the whole point of it: with the checkout as the development
    // path the host runs the sources, and checklist row A1 asks about an
    // installed artifact.
    //
    // It points at an empty directory rather than at nothing, because
    // `--extensionDevelopmentPath` is what puts the window into the extension
    // development host that honours `--extensionTestsPath` at all. Dropping the
    // flag entirely - an empty array here - launches an ordinary window that
    // opens, loads the installed extension, runs no test and never exits: a
    // hang, not a failure, which is the worst shape an unattended run can take.
    const passes: {
      name: string
      suite: string
      launchArgs: string[]
      developmentPath: string | string[]
    }[] = [
      {
        name: 'integration',
        suite: 'default',
        launchArgs: ['--disable-extensions', ...sandbox, ...profile],
        developmentPath: extensionDevelopmentPath,
      },
      {
        name: 'integration (git)',
        suite: 'git',
        launchArgs: [...sandbox, ...profile],
        developmentPath: extensionDevelopmentPath,
      },
      // Checklist row B5 asks what happens when a repository is open: the
      // workspace must never list itself as an indexed project. The default
      // pass runs on an empty window and cannot see that at all. This repo's
      // own checkout is the folder - a real repository that already exists, so
      // the row costs no fixture.
      {
        name: 'integration (workspace)',
        suite: 'workspace',
        launchArgs: ['--disable-extensions', ...sandbox, ...profile, extensionDevelopmentPath],
        developmentPath: extensionDevelopmentPath,
      },
    ]

    // Checklist rows A10, A11 and B17 replace the managed binary under the
    // scratch HOME with the pinned older build and update back out of it, and a
    // daemon started from it outlives the window. Their own launch, ordered
    // last, so no other suite ever observes a half-updated installation.
    //
    // Added only when the fixture exists. Every test in the suite needs a real
    // older build to update from, so without one the whole suite would be
    // pending - which this runner reads as zero passing tests, and would turn a
    // plain `npm run test:integration` on a developer machine red.
    if (process.env.CMM_FIXTURE_CLI && process.env.CMM_FIXTURE_CLI_OLD) {
      passes.push({
        name: 'integration (update)',
        suite: 'update',
        launchArgs: ['--disable-extensions', ...sandbox, ...profile],
        developmentPath: extensionDevelopmentPath,
      })
    }

    // Checklist row A1: the first start of an installed build. Its own launch,
    // ordered last, because it is the one pass that must not carry
    // `extensionDevelopmentPath` - and the one that must not carry
    // `--disable-extensions` either, since the installed copy is an extension.
    //
    // Gated on the packaged artifact existing, and on the artifact whose name
    // this manifest's version produces rather than on whatever `*.vsix` happens
    // to be lying around: a stale package from an earlier version would install
    // and pass while testing code nobody wrote today. Without a package the
    // suite is left out entirely - the same shape the `update` suite uses -
    // which keeps a bare `npm run test:integration` green, and which
    // scripts/check-rows.mjs reports as a suite that answered nothing rather
    // than as coverage.
    const manifest = JSON.parse(
      readFileSync(resolve(extensionDevelopmentPath, 'package.json'), 'utf8'),
    ) as { name: string; version: string }
    const vsix = resolve(extensionDevelopmentPath, `${manifest.name}-${manifest.version}.vsix`)

    if (existsSync(vsix)) {
      // Its own profile, never the one the other passes share: those launch
      // with the development copy, and a second, installed copy of the same
      // extension in their extensions directory would have both running at
      // once.
      const installedRoot = process.env.AUTOTEST_EXTENSIONS_DIR
        ? `${process.env.AUTOTEST_EXTENSIONS_DIR}-installed`
        : resolve(extensionDevelopmentPath, '.vscode-test/installed-profile')
      const installedExtensions = resolve(installedRoot, 'extensions')
      const installedUserData = resolve(installedRoot, 'user-data')
      // Holds no manifest on purpose: it exists only so the host enters the
      // extension development host, and an extension here would be a second,
      // unpackaged copy of something under test.
      const emptyDevelopmentPath = resolve(installedRoot, 'no-extension')
      rmSync(installedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      mkdirSync(emptyDevelopmentPath, { recursive: true })

      // `runVSCodeCommand` resolves bin/code.cmd and spawns it through a shell
      // on Windows - Node refuses to spawn a batch file otherwise, and it fails
      // as `status: null` with no error, which reads as an empty extensions
      // directory rather than as a failed install. It quotes the executable but
      // not the arguments, and a shell concatenates rather than escapes them,
      // so every path containing a space has to be quoted here. This checkout
      // lives under `D:\Hold\VS Code`, so that is every path.
      const quote = (value: string): string => (process.platform === 'win32' ? `"${value}"` : value)
      await runVSCodeCommand([
        '--install-extension',
        quote(vsix),
        `--extensions-dir=${quote(installedExtensions)}`,
        `--user-data-dir=${quote(installedUserData)}`,
      ])

      passes.push({
        name: 'integration (installed)',
        suite: 'installed',
        launchArgs: [
          ...sandbox,
          `--extensions-dir=${installedExtensions}`,
          `--user-data-dir=${installedUserData}`,
        ],
        developmentPath: emptyDevelopmentPath,
      })
    }

    // Both passes always run. A failing `default` pass used to abort before the
    // `git` pass launched, which left every test in that suite with no verdict
    // at all - indistinguishable, to a reader or to the autotest harness, from
    // a suite that passed.
    let failed = false

    // A suite left out of this run must not leave the previous run's verdict
    // behind: scripts/check-rows.mjs reads these files directly, so a stale
    // `installed` or `update` result would hand a row coverage from an
    // invocation that never happened here.
    for (const suite of ['default', 'git', 'workspace', 'update', 'installed']) {
      if (passes.some((pass) => pass.suite === suite)) continue
      rmSync(resolve(extensionDevelopmentPath, `.vscode-test/integration-result-${suite}.json`), {
        force: true,
      })
    }

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
          extensionDevelopmentPath: pass.developmentPath,
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
