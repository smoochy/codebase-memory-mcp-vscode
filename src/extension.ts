import * as vscode from 'vscode'
import { installOps, readTextOrNull, runProcess } from './adapters'
import { compareVersions } from './binary/assets'
import { externalCandidates, findFirstExisting, managedBinaryPath } from './binary/locate'
import { installLatest, installRelease, refusesManagedInstall, type InstallDeps } from './binary/manager'
import { gitBashCandidates, installedCopyPath, mayReplace, shimContents, shimDirectory, shimPath } from './binary/shim'
import { CliClient, type ProjectSummary } from './cli/client'
import { mergeSettings, parseConfigKeys, parseConfigList, type CliSetting } from './cli/configParse'
import { COMMAND_IDS } from './commands'
import { INSTALL_COMMAND, uninstallCommandFor, uninstallCommandForBash } from './constants'
import { LogFile } from './log-file'
import { redactSecrets, truncateForLog } from './logging'
import { activeProfileDir, firstRegistration, mcpConfigCandidates } from './mcp/registration'
import { PanelProvider } from './panel/provider'
import { wizardStepTitle, wizardSteps } from './setup/wizard'
import { computeState, updateOffer, type BinarySource, type ExtensionState } from './state/machine'
import { closeSync, existsSync, fchmodSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import { resolveLatestTag } from './binary/fetch'

let refreshTimer: NodeJS.Timeout | undefined

function setting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('betterCmm').get<T>(key) ?? fallback
}

function resolveState(storageDir: string): ExtensionState {
  const source = setting<BinarySource>('binarySource', 'auto')
  const configured = setting<string>('externalBinaryPath', '').trim()

  const managed = managedBinaryPath(storageDir, process.platform)
  const external =
    configured.length > 0 && existsSync(configured)
      ? configured
      : findFirstExisting(
          externalCandidates({
            platform: process.platform,
            home: homedir(),
            pathVar: process.env['PATH'] ?? '',
            pathSeparator: delimiter,
          }),
          existsSync,
        )

  return computeState({
    source,
    managedPath: existsSync(managed) ? managed : null,
    externalPath: external,
    registration: firstRegistration(
      mcpConfigCandidates({
        platform: process.platform,
        home: homedir(),
        appData: process.env['APPDATA'],
        // The active profile directory sits two levels above globalStorage
        // when VS Code runs on a named profile.
        profileDir: activeProfileDir(storageDir),
      }).map(readTextOrNull),
    ),
  })
}

/**
 * What `vscode.extensions.getExtension(id).exports` yields.
 *
 * Empty in production; the test hook is only present under the development
 * and test extension modes.
 */
export interface ExtensionApi {
  panelHtmlForTests?: () => string
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const storageDir = context.globalStorageUri.fsPath
  // Read from the manifest VS Code already parsed, so the panel can never
  // disagree with the installed build.
  const extensionVersion =
    typeof (context.extension.packageJSON as { version?: unknown }).version === 'string'
      ? ((context.extension.packageJSON as { version: string }).version)
      : null
  const channel = vscode.window.createOutputChannel('Better Codebase Memory MCP')
  context.subscriptions.push(channel)

  let projects: ProjectSummary[] = []
  let cliSettings: CliSetting[] = []
  /**
   * Set once registration succeeds and never cleared.
   *
   * The MCP entry is read when the host starts, so writing it mid-session
   * leaves the server unreachable until a reload. Without saying so, a
   * successful setup looks broken.
   */
  let restartRequired = false

  const panel = new PanelProvider(context.extensionUri, (command, project, value) => {
    // The webview is attacker-influenced content (project names come out of
    // the wrapped CLI's JSON), so its command string must be checked against
    // the fixed set the extension actually registered before it is executed.
    if (!(COMMAND_IDS as readonly string[]).includes(command)) {
      channel.appendLine(`ignored unknown command from webview: ${command}`)
      return
    }
    void vscode.commands.executeCommand(command, project, value)
  }, extensionVersion)

  // context.logUri is VS Code's own per-extension log directory, so the file
  // sits where a user already looks for extension logs and gets cleaned up with
  // the rest of them.
  const logFile = new LogFile(context.logUri.fsPath)

  const log = (message: string): void => {
    // Anything derived from a URL, header or process output goes through the
    // redactor before it can land in a log the user pastes into an issue.
    // Captured process output runs to megabytes (see MAX_CAPTURED_OUTPUT), and
    // one such line would otherwise be written whole, rotate the file three
    // times over, and later be opened in an editor. The head is the part that
    // says what went wrong.
    const safe = truncateForLog(redactSecrets(message))
    channel.appendLine(safe)
    logFile.append('info', safe, new Date().toISOString())
  }

  // One line on every activation, so a log a user attaches to a bug report
  // always states which build produced it - and so the file exists before
  // anything goes wrong.
  log(`activated, extension v${extensionVersion ?? 'unknown'}`)

  const fetchImpl = (url: string, init: { redirect: 'manual' }): Promise<Response> => fetch(url, init)

  /**
   * Latest tag seen on GitHub, cached for the whole session.
   *
   * `refresh` runs on a timer, so the release lookup must not go out on every
   * tick. Once per session is enough to surface an update; the user gets the
   * current answer either way when they run the update command, which resolves
   * the tag itself rather than reading this cache.
   */
  let latestTagCache: string | null = null

  /** Remote lookup failures leave the panel without update info, never break the refresh. */
  const cachedLatestTag = async (): Promise<string | null> => {
    if (latestTagCache !== null) {
      return latestTagCache
    }
    try {
      latestTagCache = await resolveLatestTag(fetchImpl)
      return latestTagCache
    } catch (cause) {
      log(`update check failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      return null
    }
  }

  /**
   * Read the CLI's own settings.
   *
   * Two calls: `config` carries the defaults and descriptions, `config list`
   * the current values. Both are plain text, not JSON, so they are parsed
   * rather than decoded.
   */
  const refreshCliSettings = async (): Promise<void> => {
    const state = resolveState(storageDir)
    if (state.activePath === null) {
      cliSettings = []
      panel.updateCliSettings(cliSettings)
      return
    }
    const client = new CliClient(state.activePath, runProcess)
    const [keys, values] = await Promise.all([client.configText([]), client.configText(['list'])])
    if (!keys.ok || !values.ok) {
      log(`reading CLI settings failed: ${keys.ok ? values.ok || '' : keys.error}`)
      cliSettings = []
    } else {
      cliSettings = mergeSettings(parseConfigKeys(keys.value), parseConfigList(values.value))
    }
    panel.updateCliSettings(cliSettings)
  }

  const refresh = async (): Promise<void> => {
    const state = resolveState(storageDir)
    let version: string | null = null
    let updateAvailable: string | null = null

    if (state.activePath !== null) {
      const client = new CliClient(state.activePath, runProcess)
      const result = await client.listProjects()
      projects = result.ok ? result.value : []

      const installed = await client.version()
      version = installed.ok ? installed.value : null

      // Skip the release lookup entirely when the answer cannot matter, so a
      // user on an external binary never causes a request to GitHub.
      const checkForUpdates = setting('checkForUpdates', true)
      if (version !== null && checkForUpdates && state.effectiveSource === 'managed') {
        updateAvailable = updateOffer({
          effectiveSource: state.effectiveSource,
          installedVersion: version,
          latestTag: await cachedLatestTag(),
          checkForUpdates,
        })
      }
    }

    panel.update({
      state,
      projects,
      version,
      updateAvailable,
      extensionVersion,
      restartRequired,
      platform: process.platform,
      gitBashAvailable: gitBashAvailable(),
      managedBinaryPresent: existsSync(managedBinaryPath(storageDir, process.platform)),
    })
  }

  /**
   * Run the CLI's own `install`, which is what writes the MCP entry.
   *
   * The state is resolved fresh rather than passed in: this runs straight
   * after a download, so any state captured before it is already stale and
   * would still report no binary.
   */
  const registerMcp = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const state = resolveState(storageDir)
    if (state.activePath === null) {
      return { ok: false, error: 'no binary to register' }
    }
    if (state.effectiveSource !== 'managed') {
      return { ok: false, error: 'the active binary is not managed by the extension' }
    }
    try {
      const output = await runProcess(state.activePath, ['install'], 120_000)
      if (output.code !== 0) {
        // The exit code was discarded before, so a failed registration looked
        // exactly like a successful one.
        const detail = output.stderr.trim() || output.stdout.trim() || 'no output'
        return { ok: false, error: `install exited with ${String(output.code)}: ${detail}` }
      }
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  /** True when a Git Bash shell exists, which then gets its own command line. */
  const gitBashAvailable = (): boolean =>
    process.platform === 'win32' &&
    gitBashCandidates({
      programFiles: process.env['ProgramFiles'],
      programFilesX86: process.env['ProgramFiles(x86)'],
      localAppData: process.env['LOCALAPPDATA'],
    }).some(existsSync)

  /**
   * Replace the full copy the CLI's installer leaves on PATH with a launcher.
   *
   * The CLI's `install` copies the whole ~36 MB binary into ~/.local/bin. That
   * leaves two independent copies which drift apart the moment one is updated,
   * and it is not what a user who asked the extension to manage the binary
   * expects to find on their PATH. The managed install stays the only real
   * copy; PATH gets a launcher pointing at it.
   */
  const installShim = (managedPath: string, replaceExistingCopy: boolean): void => {
    const home = homedir()
    const shim = shimPath(home, process.platform)
    const copy = installedCopyPath(home, process.platform)
    if (!replaceExistingCopy) {
      // The binary on PATH was already there before this run, so it is the
      // user's, not ours. The extension does not modify an installation it
      // does not own, and that has to hold here too.
      log('left the existing binary on PATH alone; no launcher written')
      return
    }
    try {
      mkdirSync(shimDirectory(home), { recursive: true })
      // Only ever the two names in that one directory, never anything else.
      if (existsSync(copy) && copy !== managedPath && mayReplace(copy, home, process.platform)) {
        rmSync(copy, { force: true })
        log(`replaced the installed copy at ${copy} with a launcher`)
      }
      // Unlink first, then create exclusively. writeFileSync and chmodSync both
      // follow symlinks, so a link planted at this name - even a dangling one,
      // which existsSync reports as absent - would have this write create the
      // attacker's target and mark it executable. rmSync removes the link
      // itself, and 'wx' refuses any name that reappears in between.
      rmSync(shim, { force: true })
      const handle = openSync(shim, 'wx', 0o755)
      try {
        writeFileSync(handle, shimContents(managedPath, process.platform), 'utf8')
        if (process.platform !== 'win32') {
          // On the descriptor, so it cannot be redirected, and so a restrictive
          // umask does not leave the launcher unexecutable.
          fchmodSync(handle, 0o755)
        }
      } finally {
        closeSync(handle)
      }
    } catch (cause) {
      // A missing launcher costs a PATH entry, not the installation.
      log(`could not write the launcher: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  const fail = (what: string, cause: unknown): void => {
    const detail = cause instanceof Error ? cause.message : String(cause)
    log(`${what} failed: ${detail}`)
    if (cause instanceof Error && cause.stack !== undefined) {
      log(cause.stack)
    }
    void vscode.window.showErrorMessage(
      `${what} failed: ${redactSecrets(detail)} - see the Better Codebase Memory MCP output for details.`,
    )
  }

  /**
   * The extension only ever touches an installation it owns. An `external`
   * setting, or a state that resolved to an external binary, is refused here
   * so no download path below can be reached at all.
   */
  const refuseIfExternal = (state: ExtensionState, what: string): boolean => {
    if (refusesManagedInstall(setting<BinarySource>('binarySource', 'auto'), state)) {
      log(`${what}: refused, the active binary is not managed by the extension`)
      void vscode.window.showWarningMessage(
        `${what} is only available for the managed binary. ` +
          `The extension does not modify an installation it does not own.`,
      )
      return true
    }
    return false
  }

  const installDeps = (report: InstallDeps['onStep']) => ({
    fetchImpl,
    run: runProcess,
    ops: installOps,
    platform: process.platform,
    arch: process.arch,
    storageDir,
    log,
    onStep: report,
  })

  const handlers: Record<
    (typeof COMMAND_IDS)[number],
    (arg?: string, value?: string) => void | Promise<void>
  > = {
    'betterCmm.runSetup': async () => {
      const state = resolveState(storageDir)
      if (refuseIfExternal(state, 'Setup')) {
        return
      }

      const managed = managedBinaryPath(storageDir, process.platform)
      if (existsSync(managed) && state.kind === 'ready-managed') {
        // Already installed and registered - nothing to download.
        await refresh()
        return
      }

      // The wizard's own remaining-step list drives the notification title,
      // so the flow the user sees is the same one wizardSteps computed.
      const firstStep = wizardSteps(state, projects.length > 0)[0]
      const title = firstStep === undefined ? 'Better Codebase Memory MCP' : firstStep.title

      try {
        const copyWasThere = existsSync(installedCopyPath(homedir(), process.platform))
      const { tag } = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title },
          async (progress) =>
            installLatest(
              installDeps((id) => progress.report({ message: wizardStepTitle(id) })),
            ),
        )
        log(`setup installed ${tag}`)

        // Registration is the second half of the same click. The panel offers
        // Setup as "installs the binary" plus "registers it as an MCP server",
        // so stopping after the download and asking the user to run a second
        // command was the flow contradicting its own description.
        const registered = await registerMcp()
        if (registered.ok) {
          restartRequired = true
          installShim(managedBinaryPath(storageDir, process.platform), !copyWasThere)
        }
        await refresh()

        if (registered.ok) {
          void vscode.window.showInformationMessage(
            `codebase-memory-mcp ${tag} installed and registered as an MCP server.`,
          )
        } else {
          log(`setup: registration failed: ${registered.error}`)
          void vscode.window
            .showWarningMessage(
              `codebase-memory-mcp ${tag} installed, but ${wizardStepTitle(
                'register-mcp',
              ).toLowerCase()} failed.`,
              'View logs',
            )
            .then((choice) => {
              if (choice === 'View logs') {
                void vscode.commands.executeCommand('betterCmm.showLogs')
              }
            })
        }
      } catch (cause) {
        fail('Setup', cause)
      }
    },
    'betterCmm.installCli': async () => {
      const result = await registerMcp()
      if (result.ok) {
        restartRequired = true
      }
      await refresh()
      if (!result.ok) {
        fail('Register MCP server', new Error(result.error))
      }
    },
    'betterCmm.copyInstallCommand': async () => {
      await vscode.env.clipboard.writeText(INSTALL_COMMAND)
      void vscode.window.showInformationMessage('Install command copied to the clipboard.')
    },
    'betterCmm.copyUninstallCommand': async () => {
      // Bound to the resolved binary: the bare name only works when the CLI is
      // on PATH, and a managed install never is, so the copied command failed
      // with "not recognised" exactly for the users who had not installed it
      // themselves.
      await vscode.env.clipboard.writeText(
        uninstallCommandFor(resolveState(storageDir).activePath),
      )
      void vscode.window.showInformationMessage(
        'Uninstall command copied. Run it in a terminal to remove codebase-memory-mcp itself.',
      )
    },
    'betterCmm.copyUninstallCommandBash': async () => {
      await vscode.env.clipboard.writeText(
        uninstallCommandForBash(resolveState(storageDir).activePath),
      )
      void vscode.window.showInformationMessage('Uninstall command copied for Git Bash.')
    },
    'betterCmm.removeManagedBinary': async () => {
      const managed = managedBinaryPath(storageDir, process.platform)
      if (!existsSync(managed)) {
        return
      }
      const confirmed = await vscode.window.showWarningMessage(
        'Remove the copy this extension installed, and its launcher on your PATH?',
        { modal: true, detail: 'Indexes and MCP entries are not touched.' },
        'Remove',
      )
      if (confirmed !== 'Remove') {
        return
      }
      const home = homedir()
      const shim = shimPath(home, process.platform)
      for (const target of [managed, shim]) {
        try {
          // The managed copy lives in the extension's own storage; the shim is
          // matched against the one name in the one directory it may occupy.
          if (target === managed || mayReplace(target, home, process.platform)) {
            rmSync(target, { force: true })
            log(`removed ${target}`)
          }
        } catch (cause) {
          fail('Removing the managed binary', cause)
          return
        }
      }
      await refresh()
    },
    'betterCmm.showSettings': async () => {
      panel.setView('settings')
      await refreshCliSettings()
    },
    'betterCmm.closeScreen': async () => {
      panel.setView('main')
      await refresh()
    },
    'betterCmm.copyBinaryDir': async () => {
      const active = resolveState(storageDir).activePath
      if (active === null) {
        return
      }
      // The folder, not the binary: this is for pasting into a terminal or a
      // PATH entry, where the executable name is in the way.
      const folder = dirname(active)
      // A bare path is not automatically safe to paste: a line break in it
      // submits the trailing segment as its own command. Same rule as the
      // uninstall command, for the same reason.
      if (/[\r\n]/.test(folder)) {
        log(`refused to copy a path containing a line break: ${folder}`)
        return
      }
      await vscode.env.clipboard.writeText(folder)
      void vscode.window.showInformationMessage(`Copied ${folder}`)
    },
    'betterCmm.setCliSetting': async (key, value) => {
      if (key === undefined || value === undefined) {
        return
      }
      const state = resolveState(storageDir)
      if (state.activePath === null) {
        return
      }
      // The key must be one the CLI itself reported. A webview message is not
      // a trustworthy source for something that becomes a CLI argument.
      if (!cliSettings.some((setting) => setting.key === key)) {
        log(`ignored unknown CLI setting: ${key}`)
        return
      }
      const result = await new CliClient(state.activePath, runProcess).setConfig(key, value)
      if (!result.ok) {
        fail(`Setting ${key}`, new Error(result.error))
      }
      await refreshCliSettings()
    },
    'betterCmm.updateBinary': async () => {
      const state = resolveState(storageDir)
      if (refuseIfExternal(state, 'Update')) {
        return
      }
      if (state.activePath === null) {
        void vscode.window.showWarningMessage('No managed binary is installed yet. Run setup first.')
        return
      }

      try {
        const installed = await new CliClient(state.activePath, runProcess).version()
        if (!installed.ok) {
          throw new Error(`could not read the installed version: ${installed.error}`)
        }

        const latestTag = await resolveLatestTag(fetchImpl)

        if (compareVersions(latestTag, installed.value) <= 0) {
          void vscode.window.showInformationMessage(
            `codebase-memory-mcp is already up to date (${installed.value}).`,
          )
          return
        }

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: wizardStepTitle('download-binary') },
          async (progress) =>
            installRelease(
              latestTag,
              installDeps((id) => progress.report({ message: wizardStepTitle(id) })),
            ),
        )
        log(`update installed ${latestTag} (was ${installed.value})`)
        // The freshly resolved tag is now the installed one, so the cached
        // answer would otherwise keep offering an update that already happened.
        latestTagCache = latestTag
        await refresh()
        void vscode.window.showInformationMessage(
          `codebase-memory-mcp updated to ${latestTag}. Restart the MCP server ` +
            `(or reload the window) for the new binary to take effect.`,
        )
      } catch (cause) {
        fail('Update', cause)
      }
    },
    'betterCmm.addProject': async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: true,
        openLabel: 'Add repositories',
      })
      const state = resolveState(storageDir)
      if (picked === undefined || state.activePath === null) {
        return
      }
      const client = new CliClient(state.activePath, runProcess, 300_000)
      // Note: workspace folders are never touched here.
      const failures: string[] = []
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Indexing repositories' },
        async (progress) => {
          for (const [done, folder] of picked.entries()) {
            progress.report({
              message: `${folder.fsPath} (${String(done + 1)}/${String(picked.length)})`,
            })
            const result = await client.addProject(folder.fsPath)
            if (!result.ok) {
              // Silence here was the whole problem: indexing could fail on
              // every folder and the panel just stayed empty.
              failures.push(`${folder.fsPath}: ${result.error}`)
              log(`addProject failed for ${folder.fsPath}: ${result.error}`)
            }
          }
        },
      )
      if (failures.length > 0) {
        void vscode.window.showErrorMessage(
          `Could not index ${String(failures.length)} of ${String(picked.length)} repositories.`,
          'View logs',
        ).then((choice) => {
          if (choice === 'View logs') {
            void vscode.commands.executeCommand('betterCmm.showLogs')
          }
        })
      }
      await refresh()
    },
    'betterCmm.removeProject': async (name) => {
      const state = resolveState(storageDir)
      if (name === undefined || state.activePath === null) {
        return
      }
      // `name` comes from the webview, which is filled from attacker-influenced
      // CLI JSON. Resolve it against the project list we fetched ourselves
      // rather than trusting it, so it can never become a raw CLI argument.
      const project = projects.find((p) => p.name === name)
      if (project === undefined) {
        channel.appendLine(`ignored removeProject for unknown project: ${name}`)
        return
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Remove ${project.name} from the index?`,
        { modal: true },
        'Remove',
      )
      if (confirmed !== 'Remove') {
        return
      }
      await new CliClient(state.activePath, runProcess).removeProject(project.name)
      await refresh()
    },
    'betterCmm.refresh': refresh,
    // Opens the log file itself, not the output panel: a file can be scrolled,
    // searched, and attached to a bug report, and it survives a window reload.
    // Falls back to the channel when nothing has been written yet.
    'betterCmm.showLogs': async () => {
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logFile.path))
        await vscode.window.showTextDocument(document, { preview: false })
      } catch {
        channel.show(false)
      }
    },
    'betterCmm.openSettings': async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:smoochy.better-codebase-memory-mcp')
    },
    'betterCmm.reindex': async () => {
      const state = resolveState(storageDir)
      if (state.activePath === null || projects.length === 0) {
        return
      }
      // Re-running index_repository against a known root is what refreshes an
      // existing project; there is no separate reindex tool.
      const roots = projects.map((project) => project.root_path)
      const client = new CliClient(state.activePath, runProcess, 300_000)
      const failures: string[] = []
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Reindexing projects' },
        async (progress) => {
          for (const [done, root] of roots.entries()) {
            progress.report({ message: `${root} (${String(done + 1)}/${String(roots.length)})` })
            const result = await client.addProject(root)
            if (!result.ok) {
              failures.push(root)
              log(`reindex failed for ${root}: ${result.error}`)
            }
          }
        },
      )
      if (failures.length > 0) {
        void vscode.window
          .showErrorMessage(
            `Could not reindex ${String(failures.length)} of ${String(roots.length)} projects.`,
            'View logs',
          )
          .then((choice) => {
            if (choice === 'View logs') {
              void vscode.commands.executeCommand('betterCmm.showLogs')
            }
          })
      }
      await refresh()
    },
  }

  for (const id of COMMAND_IDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (arg?: string, value?: string) =>
        handlers[id](arg, value),
      ),
    )
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panel),
  )

  // Polling only, no FileSystemWatcher: the CLI watches files itself.
  if (setting('autoRefresh', true)) {
    const seconds = Math.max(5, setting('refreshIntervalSeconds', 30))
    refreshTimer = setInterval(() => {
      if (panel.isVisible && !panel.isOnSubScreen) {
        void refresh()
      }
    }, seconds * 1000)
    const timer = refreshTimer
    context.subscriptions.push({
      dispose: () => {
        clearInterval(timer)
        if (refreshTimer === timer) {
          refreshTimer = undefined
        }
      },
    })
  }

  void refresh()

  // Surfaced as `extension.exports`, which every installed extension can
  // read. The panel markup holds nothing a co-installed extension could not
  // already read from disk, but this exists only so the integration suite can
  // assert on what the running host rendered, so it stays out of production
  // rather than widening the exported surface for no user-facing reason.
  return context.extensionMode === vscode.ExtensionMode.Production
    ? {}
    : { panelHtmlForTests: () => panel.renderedHtml }
}

export function deactivate(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
}
