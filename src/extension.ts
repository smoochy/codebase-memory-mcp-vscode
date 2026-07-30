import * as vscode from 'vscode'
import { readTextOrNull, runProcess } from './adapters'
import { externalCandidates, findFirstExisting, managedBinaryPath } from './binary/locate'
import { CliClient, type ProjectSummary } from './cli/client'
import { COMMAND_IDS } from './commands'
import { INSTALL_COMMAND, UNINSTALL_COMMAND } from './constants'
import { activeProfileDir, firstRegistration, mcpConfigCandidates } from './mcp/registration'
import { PanelProvider } from './panel/provider'
import { computeState, type BinarySource, type ExtensionState } from './state/machine'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter } from 'node:path'

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

export function activate(context: vscode.ExtensionContext): void {
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

  const refresh = async (): Promise<void> => {
    const state = resolveState(storageDir)
    if (state.activePath !== null) {
      const result = await new CliClient(state.activePath, runProcess).listProjects()
      projects = result.ok ? result.value : []
    }
    panel.update({ state, projects, version: null, updateAvailable: null })
  }

  const handlers: Record<(typeof COMMAND_IDS)[number], (arg?: string) => void | Promise<void>> = {
    'betterCmm.runSetup': () => void vscode.commands.executeCommand('betterCmm.refresh'),
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
    'betterCmm.updateBinary': () => void vscode.commands.executeCommand('betterCmm.refresh'),
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
}

export function deactivate(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
}
