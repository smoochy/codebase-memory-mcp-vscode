import * as vscode from 'vscode'
import { installOps, readTextOrNull, runProcess } from './adapters'
import { compareVersions } from './binary/assets'
import { externalCandidates, findFirstExisting, managedBinaryPath } from './binary/locate'
import { installLatest, installRelease, refusesManagedInstall, type InstallDeps } from './binary/manager'
import { CliClient, type ProjectSummary } from './cli/client'
import { COMMAND_IDS } from './commands'
import { INSTALL_COMMAND, UNINSTALL_COMMAND } from './constants'
import { redactSecrets } from './logging'
import { activeProfileDir, firstRegistration, mcpConfigCandidates } from './mcp/registration'
import { PanelProvider } from './panel/provider'
import { wizardStepTitle, wizardSteps } from './setup/wizard'
import { computeState, updateOffer, type BinarySource, type ExtensionState } from './state/machine'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter } from 'node:path'
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

/** What `vscode.extensions.getExtension(id).exports` yields. */
export interface ExtensionApi {
  panelHtmlForTests: () => string
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const storageDir = context.globalStorageUri.fsPath
  const channel = vscode.window.createOutputChannel('Better Codebase Memory MCP')
  context.subscriptions.push(channel)

  let projects: ProjectSummary[] = []

  const panel = new PanelProvider(context.extensionUri, (command, project) => {
    // The webview is attacker-influenced content (project names come out of
    // the wrapped CLI's JSON), so its command string must be checked against
    // the fixed set the extension actually registered before it is executed.
    if (!(COMMAND_IDS as readonly string[]).includes(command)) {
      channel.appendLine(`ignored unknown command from webview: ${command}`)
      return
    }
    void vscode.commands.executeCommand(command, project)
  })

  const log = (message: string): void => {
    // Anything derived from a URL, header or process output goes through the
    // redactor before it can land in a log the user pastes into an issue.
    channel.appendLine(redactSecrets(message))
  }

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

    panel.update({ state, projects, version, updateAvailable })
  }

  const fail = (what: string, cause: unknown): void => {
    const detail = cause instanceof Error ? cause.message : String(cause)
    log(`${what} failed: ${detail}`)
    if (cause instanceof Error && cause.stack !== undefined) {
      log(cause.stack)
    }
    void vscode.window.showErrorMessage(
      `${what} failed: ${redactSecrets(detail)} — see the Better Codebase Memory MCP output for details.`,
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

  const handlers: Record<(typeof COMMAND_IDS)[number], (arg?: string) => void | Promise<void>> = {
    'betterCmm.runSetup': async () => {
      const state = resolveState(storageDir)
      if (refuseIfExternal(state, 'Setup')) {
        return
      }

      const managed = managedBinaryPath(storageDir, process.platform)
      if (existsSync(managed) && state.kind === 'ready-managed') {
        // Already installed and registered — nothing to download.
        await refresh()
        return
      }

      // The wizard's own remaining-step list drives the notification title,
      // so the flow the user sees is the same one wizardSteps computed.
      const firstStep = wizardSteps(state, projects.length > 0)[0]
      const title = firstStep === undefined ? 'Better Codebase Memory MCP' : firstStep.title

      try {
        const { tag } = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title },
          async (progress) =>
            installLatest(
              installDeps((id) => progress.report({ message: wizardStepTitle(id) })),
            ),
        )
        log(`setup installed ${tag}`)
        await refresh()
        void vscode.window.showInformationMessage(
          `codebase-memory-mcp ${tag} installed. ` +
            `${wizardStepTitle('register-mcp')} is the next step — ` +
            `run "Install CLI" so the CLI writes its own MCP entry.`,
        )
      } catch (cause) {
        fail('Setup', cause)
      }
    },
    'betterCmm.installCli': async () => {
      const state = resolveState(storageDir)
      if (state.activePath === null || state.effectiveSource !== 'managed') {
        return
      }
      await runProcess(state.activePath, ['install'], 120_000)
      await refresh()
    },
    'betterCmm.copyInstallCommand': async () => {
      await vscode.env.clipboard.writeText(INSTALL_COMMAND)
      void vscode.window.showInformationMessage('Install command copied to the clipboard.')
    },
    'betterCmm.copyUninstallCommand': async () => {
      await vscode.env.clipboard.writeText(UNINSTALL_COMMAND)
      void vscode.window.showInformationMessage(
        'Uninstall command copied. Run it in a terminal to remove codebase-memory-mcp itself.',
      )
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
      for (const folder of picked) {
        await client.addProject(folder.fsPath)
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
    'betterCmm.showLogs': () => channel.show(),
  }

  for (const id of COMMAND_IDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (arg?: string) => handlers[id](arg)),
    )
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panel),
  )

  // Polling only, no FileSystemWatcher: the CLI watches files itself.
  if (setting('autoRefresh', true)) {
    const seconds = Math.max(5, setting('refreshIntervalSeconds', 30))
    refreshTimer = setInterval(() => {
      if (panel.isVisible) {
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

  // Returned to whoever activates the extension; VS Code surfaces it as
  // `extension.exports`. The integration suite reads the panel's real markup
  // through this, which is the only check that sees what the packaged bundle
  // renders rather than what the current source would render.
  return { panelHtmlForTests: () => panel.renderedHtml }
}

export function deactivate(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
}
