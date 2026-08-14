import * as vscode from 'vscode'
import { installOps, readTextOrNull, runProcess } from './adapters'
import { compareVersions } from './binary/assets'
import { externalCandidates, findFirstExisting, managedBinaryPath } from './binary/locate'
import {
  installLatest,
  installRelease,
  refusesManagedInstall,
  type InstallDeps,
  type InstallResult,
} from './binary/manager'
import { engineLogDirectory, gitBashCandidates, projectStorePath } from './binary/shells'
import { CliClient, type ProjectSummary } from './cli/client'
import { mergeSettings, parseConfigKeys, parseConfigList, type CliSetting } from './cli/configParse'
import { COMMAND_IDS } from './commands'
import {
  daemonStopCommandFor,
  daemonStopCommandForBash,
  uninstallCommandFor,
  uninstallCommandForBash,
} from './constants'
import { LogFile } from './log-file'
import { redactSecrets, shouldLog, truncateForLog, type LogLevel } from './logging'
import {
  mcpConfigCandidates,
  mentionsOurServer,
  userConfigRoot,
  withoutMcpEntry,
} from './mcp/registration'
import { folderName, formatBytes } from './panel/html'
import { PanelProvider } from './panel/provider'
import { wizardStepTitle, wizardSteps } from './setup/wizard'
import { advanceIndexRecord, type IndexRecord } from './state/indexRecord'
import { computeState, samePath, updateOffer, type BinarySource, type ExtensionState } from './state/machine'
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { createLatestTagCache, resolveLatestTag, withRetry } from './binary/fetch'

let refreshTimer: NodeJS.Timeout | undefined

/**
 * The part of the built-in git extension's API this extension uses.
 *
 * Declared here rather than imported: `vscode.git` ships its `git.d.ts` in its
 * own source tree, which is not published as a package, so the shape has to be
 * stated by whoever consumes it. Only the head commit is read.
 */
interface GitRepository {
  state: { HEAD?: { commit?: string } }
}
interface GitExports {
  getAPI(version: 1): {
    getRepository(uri: vscode.Uri): GitRepository | null
    openRepository(uri: vscode.Uri): Thenable<GitRepository | null>
  }
}

function setting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('betterCmm').get<T>(key) ?? fallback
}

/**
 * A numeric setting, clamped and guaranteed finite.
 *
 * `get<T>()` casts rather than validates, and the schema's minimum/maximum
 * only bind the settings editor - a hand-edited settings file hands the raw
 * value straight through. Left unchecked, a non-numeric log size becomes NaN,
 * every size comparison against it is false, and rotation stops silently on
 * the one file that now grows for the life of the installation.
 */
function numberSetting(key: string, fallback: number, low: number, high: number): number {
  const raw = Number(setting<unknown>(key, fallback))
  return Number.isFinite(raw) ? Math.min(high, Math.max(low, Math.round(raw))) : fallback
}

/**
 * Summarise what `index_repository` reported.
 *
 * The counts are the only evidence that the call did anything: indexing is
 * incremental, so an unchanged repository returns in well under a second with
 * the same numbers and without touching its store file.
 */
function indexReport(payload: unknown, before?: { nodes?: number; edges?: number }): string {
  if (typeof payload !== 'object' || payload === null) {
    return 'done'
  }
  const record = payload as { nodes?: unknown; edges?: unknown; skipped_count?: unknown }

  /** "7,301 nodes (+12)", or just the count when there is nothing to compare. */
  const withDelta = (value: unknown, was: number | undefined, label: string): string | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null
    }
    const shown = `${value.toLocaleString('en-US')} ${label}`
    if (was === undefined || was === value) {
      return shown
    }
    const delta = value - was
    return `${shown} (${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')})`
  }

  const parts = [
    withDelta(record.nodes, before?.nodes, 'nodes'),
    withDelta(record.edges, before?.edges, 'edges'),
  ].filter((part): part is string => part !== null)

  if (typeof record.skipped_count === 'number' && record.skipped_count > 0) {
    parts.push(`${record.skipped_count.toLocaleString('en-US')} skipped`)
  }
  if (parts.length === 0) {
    return 'done'
  }
  // Saying so outright beats leaving the reader to compare two numbers: an
  // unchanged repository is the common case, and it is what "nothing seemed to
  // happen" actually looked like.
  const unchanged =
    before !== undefined && record.nodes === before.nodes && record.edges === before.edges
  return unchanged ? `${parts.join(', ')} - unchanged` : parts.join(', ')
}

/**
 * Key under which the extension records that it installed the binary itself.
 *
 * Ownership cannot be inferred from the location: the CLI's own installer
 * targets the same directory, so a user who installed it themselves would
 * otherwise have their binary treated as the extension's - offered for update,
 * overwritten, and offered for deletion, against the rule that the extension
 * never modifies an installation it does not own.
 */
const OWNED_INSTALL_KEY = 'betterCmm.managedInstallPath'
const INDEX_RECORDS_KEY = 'betterCmm.indexRecords'


function resolveState(ownedInstallPath: string | null): ExtensionState {
  const source = setting<BinarySource>('binarySource', 'auto')
  const configured = setting<string>('externalBinaryPath', '').trim()

  const candidate = managedBinaryPath(homedir(), process.platform)
  // Only a binary this extension recorded installing counts as managed.
  const managed = ownedInstallPath !== null && samePath(ownedInstallPath, candidate) ? candidate : ''
  const external =
    configured.length > 0 && existsSync(configured)
      ? configured
      : findFirstExisting(
          externalCandidates({
            platform: process.platform,
            home: homedir(),
            pathVar: process.env['PATH'] ?? '',
            pathSeparator: delimiter,
          })
            // The managed binary now lives on PATH, which is also the first
            // place the external search looks. Without this the extension
            // finds its own install, calls it the user's, and then refuses to
            // update or re-register it.
            // samePath, not string equality: a PATH entry can spell the same
            // directory with different case or separators on Windows.
            .filter((entry) => managed === '' || !samePath(entry, managed)),
          existsSync,
        )

  return computeState({
    source,
    managedPath: managed !== '' && existsSync(managed) ? managed : null,
    externalPath: external,
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
  /** How often the hidden-panel update check has run. See `updateBadgeCheck`. */
  updateChecksForTests?: () => number
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
   * Set once a newly installed binary replaces the one a server already runs.
   *
   * The definition is provided live, so nothing has to be reloaded for the
   * server to exist - but a server VS Code already started is still the process
   * from the old file, and saying nothing leaves the user with an update that
   * appears not to have taken.
   */
  let restartRequired: false | 'binary' = false
  /**
   * Why the daemon left over from the replaced binary is still running, or
   * null when there is nothing to report.
   *
   * Cleared by the next refresh that reaches the CLI, because a call that
   * succeeds is proof the conflict is gone - whether the user retired the
   * daemon by hand or it exited on its own.
   */
  let daemonStopFailure: string | null = null

  /** Path this extension recorded installing, or null when it installed nothing. */
  const ownedInstallPath = (): string | null =>
    context.globalState.get<string>(OWNED_INSTALL_KEY) ?? null

  /**
   * Head commit of a checkout, or null when there is none to read.
   *
   * CLI 0.10.x dropped the `git` object from `list_projects` and no other tool
   * it exposes reports a commit, so the sha that stale detection compares
   * against comes from the checkout itself. VS Code's own git extension is the
   * reader: it is built in, and it already resolves packed refs, detached
   * heads, worktrees and the gitdir files submodules use - every one of which
   * a hand-written `.git/HEAD` parser would have to get right on a path the
   * user chose.
   */
  const headCommit = async (rootPath: string): Promise<string | null> => {
    const extension = vscode.extensions.getExtension<GitExports>('vscode.git')
    // Only ever read from an already-active git extension, never activated
    // here: under `--disable-extensions` the built-in one is present but
    // disabled, and awaiting its activation never returns - which hung the
    // refresh in the integration tier rather than failing it. Nothing is lost
    // by waiting, because a refresh runs every few seconds and the git
    // extension activates on startup wherever there is a repository at all.
    if (extension === undefined || !extension.isActive) {
      return null
    }
    try {
      const api = extension.exports.getAPI(1)
      const uri = vscode.Uri.file(rootPath)
      // `getRepository` only answers for repositories the git extension has
      // already opened, which is the workspace's own. A project indexed from
      // somewhere else is opened once here and cached by that extension from
      // then on, so this is not a per-refresh cost.
      const repository = api.getRepository(uri) ?? (await api.openRepository(uri))
      const commit = repository?.state.HEAD?.commit
      return typeof commit === 'string' && commit.length > 0 ? commit : null
    } catch {
      // A root that is not a repository, or has been deleted, is not an error
      // to report: it means no claim can be made about staleness, which is the
      // same answer as a project the extension has never indexed.
      return null
    }
  }

  /**
   * What the extension remembers about each index it built.
   *
   * 0.9.x reported a `git.base_sha`, which read like the commit the index was
   * built from and was not: it was written when a project was first added and
   * a later reindex left it untouched, so comparing against it marked a
   * project outdated permanently - measured directly against the real binary,
   * including immediately after a reindex reported success. So the extension
   * keeps its own note instead, and a project it has never indexed gets no
   * note and therefore no claim either way. 0.10.x removed both shas, which
   * costs this nothing: the note was always the extension's own.
   */
  const indexRecords = (): Record<string, IndexRecord> =>
    context.globalState.get<Record<string, IndexRecord>>(INDEX_RECORDS_KEY) ?? {}

  const rememberIndexed = async (name: string, head: unknown): Promise<void> => {
    const records: Record<string, IndexRecord> = Object.assign(
      Object.create(null) as Record<string, IndexRecord>,
      indexRecords(),
    )
    records[name] = {
      sha: typeof head === 'string' && head.length > 0 ? head : null,
      at: Date.now(),
    }
    await context.globalState.update(INDEX_RECORDS_KEY, records)
  }

  /** Reindexes already running, so two of them never touch one store at once. */
  const inFlight = new Set<string>()

  /** Projects already reported as outdated, so the log says it once per change. */
  const reportedStale = new Set<string>()

  /** Fallback timestamp: the mtime of the store file the CLI writes per project. */
  const storeMtime = (name: string): number | undefined => {
    const store = projectStorePath(homedir(), name)
    if (store === null) {
      return undefined
    }
    try {
      return statSync(store).mtimeMs
    } catch {
      return undefined
    }
  }

  const panel = new PanelProvider(context.extensionUri, (command, project, value) => {
    // The webview is attacker-influenced content (project names come out of
    // the wrapped CLI's JSON), so its command string must be checked against
    // the fixed set the extension actually registered before it is executed.
    if (!(COMMAND_IDS as readonly string[]).includes(command)) {
      warn(`ignored unknown command from webview: ${command}`)
      return
    }
    void vscode.commands.executeCommand(command, project, value)
  }, extensionVersion)

  // globalStorage, not context.logUri: VS Code creates a fresh log directory
  // per window session, so the log that explains a crash is in the directory
  // the crash ended and the next session starts an empty one. Here it
  // accumulates across sessions and rotation is what bounds it.
  const logFile = new LogFile(
    join(storageDir, 'logs'),
    'better-cmm.log',
    numberSetting('logMaxSizeMb', 1, 1, 100) * 1024 * 1024,
    numberSetting('logKeptFiles', 3, 1, 20),
  )

  const logAt = (level: LogLevel, message: string): void => {
    if (!shouldLog(level, setting('logLevel', 'info'))) {
      return
    }
    // Anything derived from a URL, header or process output goes through the
    // redactor before it can land in a log the user pastes into an issue.
    // Captured process output runs to megabytes (see MAX_CAPTURED_OUTPUT), and
    // one such line would otherwise be written whole, rotate the file three
    // times over, and later be opened in an editor. The head is the part that
    // says what went wrong.
    const safe = truncateForLog(redactSecrets(message))
    channel.appendLine(`[${level.toUpperCase()}] ${safe}`)
    logFile.append(level, safe, new Date().toISOString())
  }

  const log = (message: string): void => {
    logAt('info', message)
  }
  const debug = (message: string): void => {
    logAt('debug', message)
  }
  const warn = (message: string): void => {
    logAt('warn', message)
  }

  // One line on every activation, so a log a user attaches to a bug report
  // always states which build produced it - and so the file exists before
  // anything goes wrong.
  log(`activated, extension v${extensionVersion ?? 'unknown'}`)

  /**
   * Record changes to the extension's own settings.
   *
   * Only CLI settings were logged, because only those go through a handler.
   * VS Code's own settings change behind the extension's back, so the previous
   * values are kept here and diffed when it reports a change - otherwise the
   * log says a setting changed without saying to what, or says nothing at all.
   */
  const watchedSettings = [
    'binarySource',
    'externalBinaryPath',
    'autoRefresh',
    'refreshIntervalSeconds',
    'autoReindex',
    'autoReindexIntervalSeconds',
    'absoluteTimestamps',
    'dateLocale',
    'checkForUpdates',
    'logLevel',
    'logMaxSizeMb',
    'logKeptFiles',
  ] as const
  const snapshotSettings = (): Map<string, string> =>
    new Map(
      watchedSettings.map((key) => [
        key,
        (JSON.stringify(setting<unknown>(key, null)) ?? 'null').slice(0, 200),
      ]),
    )
  let previousSettings = snapshotSettings()

  /** Assigned once the timers exist, further down. */
  let rearmTimers: () => void = () => {
    /* not armed yet */
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('betterCmm')) {
        return
      }
      const current = snapshotSettings()
      const before = previousSettings
      previousSettings = current
      for (const [key, value] of current) {
        const was = before.get(key)
        if (was !== value) {
          log(`User: extension setting ${key} ${was ?? 'unset'} -> ${value}`)
        }
      }
      // The log file's own limits are read once at construction, so a change
      // to them needs saying out loud rather than appearing not to work.
      if (
        current.get('logMaxSizeMb') !== before.get('logMaxSizeMb') ||
        current.get('logKeptFiles') !== before.get('logKeptFiles')
      ) {
        debug('log size settings take effect after the window is reloaded')
      }
      // Both intervals are read when the timers are armed, so switching either
      // one on has to re-arm them - otherwise the setting appears to do nothing
      // until the window is reloaded.
      if (
        ['autoRefresh', 'refreshIntervalSeconds', 'autoReindex', 'autoReindexIntervalSeconds'].some(
          (key) => current.get(key) !== before.get(key),
        )
      ) {
        rearmTimers()
      }
      // Only the settings that change what a refresh would produce: which
      // binary runs, whether an update is offered, how times are rendered.
      // Leaving the screen refreshes anyway, so refreshing on every setting
      // meant two CLI round trips a second apart for a change - a log level,
      // an interval - that the panel does not display at all.
      if (
        ['binarySource', 'externalBinaryPath', 'checkForUpdates', 'absoluteTimestamps', 'dateLocale'].some(
          (key) => current.get(key) !== before.get(key),
        )
      ) {
        void refresh()
      }
    }),
  )

  // `fetch` answers an unreachable host with the bare "fetch failed", which is
  // the whole message the panel then shows. Naming the host here is what tells
  // an offline machine apart from a broken install, and it covers every request
  // the extension makes, since they all go through this one function.
  // The retry sits underneath the naming, not above it: it decides on the raw
  // cause, and the host is named once, on the failure the user actually sees.
  const retryingFetch = withRetry(fetch)
  const fetchImpl = async (url: string, init: { redirect: 'manual' }): Promise<Response> => {
    try {
      return await retryingFetch(url, init)
    } catch (cause) {
      throw new Error(`could not reach ${new URL(url).host}: ${String(cause)}`, { cause })
    }
  }

  /**
   * Latest tag seen on GitHub, cached until it goes stale.
   *
   * `refresh` runs on a timer, so the release lookup must not go out on every
   * tick; the user gets the current answer either way when they run the update
   * command, which resolves the tag itself rather than reading this cache.
   */
  const latestTagCache = createLatestTagCache(fetchImpl)

  /** Remote lookup failures leave the panel without update info, never break the refresh. */
  const cachedLatestTag = async (): Promise<string | null> => {
    try {
      return await latestTagCache.get()
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
    const state = resolveState(ownedInstallPath())
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

  // The refresh loop asks about releases every thirty seconds; the answer is
  // worth one line, not one line per poll. Reset when the offer goes away, so
  // an update taken and a later one found are two separate records.
  let updateLogged = false

  // The installed CLI version as of the last refresh. Reading it costs a
  // process launch, so the badge check that runs with the panel hidden asks
  // this instead: the binary cannot change while nobody is looking at the
  // panel, because installing one goes through it.
  let lastKnownVersion: string | null = null

  /** Test-only counter, read through `updateChecksForTests`. */
  let updateChecks = 0

  /**
   * The server VS Code is currently being offered, if any.
   *
   * The definition is provided rather than written to `mcp.json`, so it lives
   * in memory for exactly as long as this extension host does and never reaches
   * Settings Sync. The `version` carries the CLI's own version so that an
   * update to the same path still reads as a changed server.
   */
  let mcpServer: { command: string; version: string } | null = null
  const mcpServersChanged = new vscode.EventEmitter<void>()
  context.subscriptions.push(mcpServersChanged)
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('betterCmm.codebaseMemory', {
      onDidChangeMcpServerDefinitions: mcpServersChanged.event,
      provideMcpServerDefinitions: () =>
        mcpServer === null
          ? []
          : [
              new vscode.McpStdioServerDefinition(
                'Codebase Memory',
                mcpServer.command,
                [],
                {},
                mcpServer.version,
              ),
            ],
    }),
  )

  /**
   * Offer the active binary as the MCP server, and say so when it changes.
   *
   * Called from the refresh loop, so every path that can change the active
   * binary - Setup, an update, a `binarySource` change, a vanished external
   * install - reaches it without each one having to remember to.
   */
  const publishMcpServer = (state: ExtensionState, version: string | null): void => {
    // A version check that failed this tick is not a changed server. Keeping
    // the last known version for the same command stops one busy binary from
    // reading as a new server and prompting an agent to refresh its tools.
    const keptVersion =
      version ??
      (state.activePath !== null && state.activePath === mcpServer?.command
        ? mcpServer.version
        : 'unknown')
    const next =
      state.activePath === null ? null : { command: state.activePath, version: keptVersion }
    if (next?.command === mcpServer?.command && next?.version === mcpServer?.version) {
      return
    }
    mcpServer = next
    mcpServersChanged.fire()
    log(
      next === null
        ? 'no binary to offer as an MCP server'
        : `offering ${next.command} (v${next.version}) as an MCP server`,
    )
  }

  const refresh = async (): Promise<void> => {
    const state = resolveState(ownedInstallPath())
    let version: string | null = null
    let updateAvailable: string | null = null

    if (state.activePath !== null) {
      const client = new CliClient(state.activePath, runProcess)
      const result = await client.listProjects()
      // A call that got through is the proof the conflicting daemon is gone.
      if (result.ok) {
        daemonStopFailure = null
      }
      // Null prototype: the keys are project names the CLI chose, and on a
      // plain object `__proto__` is an assignment to the prototype rather than
      // an entry.
      const records: Record<string, IndexRecord> = Object.assign(
        Object.create(null) as Record<string, IndexRecord>,
        indexRecords(),
      )
      let recordsChanged = false

      projects = await Promise.all(
        (result.ok ? result.value : []).map(async (project) => {
        const head = await headCommit(project.root_path)
        const existing = records[project.name]
        const mtime = storeMtime(project.name)
        const record = advanceIndexRecord(existing, head, mtime)
        if (record !== undefined && record !== existing) {
          records[project.name] = record
          recordsChanged = true
        }
        return {
          ...project,
          // The store file's mtime, not the time of the last reindex request.
          // Indexing is incremental: a reindex that finds nothing changed does
          // not touch the file, and reporting "just now" for it claimed work
          // that did not happen. This is when the index last actually changed.
          indexed_at_ms: mtime ?? record?.at,
          stale:
            record?.sha != null && head !== null ? record.sha !== head : undefined,
        }
        }),
      )

      // Say it once per project, when it changes: a refresh runs every few
      // seconds, and repeating "outdated" on every tick buries the log.
      for (const project of projects) {
        if (project.stale === true && !reportedStale.has(project.name)) {
          reportedStale.add(project.name)
          // The counts as they stood when the index fell behind, so a later
          // reindex line can be read against them without hunting for the
          // panel's numbers at that moment.
          const counts =
            project.nodes === undefined && project.edges === undefined
              ? ''
              : ` Currently ${String(project.nodes ?? 0)} nodes, ${String(project.edges ?? 0)} edges.`
          log(
            `"${folderName(project.root_path)}" (${project.root_path}) is outdated: ` +
              `the checkout moved to another commit.${counts}`,
          )
        } else if (project.stale !== true) {
          reportedStale.delete(project.name)
        }
      }

      if (result.ok) {
        // Only prune against a list that actually arrived; a failed call would
        // otherwise throw away every note the extension has.
        for (const name of Object.keys(records)) {
          if (!projects.some((project) => project.name === name)) {
            delete records[name]
            recordsChanged = true
          }
        }
      } else {
        warn(`listing projects failed: ${result.error}`)
      }
      if (recordsChanged) {
        await context.globalState.update(INDEX_RECORDS_KEY, records)
      }

      const installed = await client.version()
      version = installed.ok ? installed.value : null
      lastKnownVersion = version

      // Skip the release lookup entirely when the answer cannot matter. An
      // external binary is looked up too: the extension will not update it,
      // but "there is a newer one" is still worth telling its owner.
      const checkForUpdates = setting('checkForUpdates', true)
      if (version !== null && checkForUpdates) {
        updateAvailable = updateOffer({
          installedVersion: version,
          latestTag: await cachedLatestTag(),
          checkForUpdates,
        })
      }
    }

    if (updateAvailable === null) {
      updateLogged = false
    } else if (!updateLogged) {
      updateLogged = true
      debug(
        `update available: ${updateAvailable} (installed ${version ?? 'unknown'}, ` +
          `${state.effectiveSource ?? 'unresolved'} binary)`,
      )
    }

    publishMcpServer(state, version)

    debug(
      `refresh: ${state.kind}, source ${String(state.effectiveSource)}, ` +
        `${String(projects.length)} project(s), CLI ${version ?? 'unknown'}`,
    )
    panel.update({
      state,
      projects,
      version,
      updateAvailable,
      extensionVersion,
      restartRequired,
      daemonStopFailure,
      platform: process.platform,
      gitBashAvailable: gitBashAvailable(),
      managedBinaryPresent: existsSync(managedBinaryPath(homedir(), process.platform)),
      absoluteTime: setting('absoluteTimestamps', false),
      dateLocale: setting('dateLocale', ''),
    })
  }

  /**
   * The update half of `refresh`, for ticks where the panel is hidden.
   *
   * Nothing here launches a process: the installed version is the one the last
   * refresh read, and the release tag comes from its cache. A window that is
   * never opened still learns about a release this way, which is the whole
   * reason the badge lives on a view of its own.
   */
  const updateBadgeCheck = async (): Promise<void> => {
    // Counted before the settings are read: what the integration tier has to
    // prove is that the timer reaches this at all with the panel hidden, and
    // on a host with no CLI installed there is no offer to observe instead.
    updateChecks += 1
    const checkForUpdates = setting('checkForUpdates', true)
    if (!checkForUpdates || lastKnownVersion === null) {
      return
    }
    const updateAvailable = updateOffer({
      installedVersion: lastKnownVersion,
      latestTag: await cachedLatestTag(),
      checkForUpdates,
    })
    if (updateAvailable !== null && !updateLogged) {
      updateLogged = true
      debug(`update available: ${updateAvailable} (installed ${lastKnownVersion})`)
    }
    panel.setUpdateAvailable(updateAvailable)
  }

  /** The named profiles of this installation, empty when there are none. */
  const profileIds = (): string[] => {
    const root = userConfigRoot(storageDir)
    if (root === null) {
      return []
    }
    try {
      return readdirSync(`${root}/profiles`, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
  }

  /**
   * Take our own entry back out of every `mcp.json` of this installation.
   *
   * VS Code is served by the definition provider, so an entry on disk is a
   * second copy of the same server carrying an absolute path - and that file is
   * synced, where another machine's path cannot start. The CLI detects VS Code
   * as an agent and writes it into every profile it finds, with no flag to
   * deselect one, so this undoes that one key wherever it landed and leaves
   * every other server in each file alone.
   *
   * Run at activation as well as after `install`, so a machine that never runs
   * Setup again still heals the entries Settings Sync delivered to it.
   *
   * Deliberately a stopgap, removable once the CLI can be told to skip VS Code.
   * Best-effort by design: the provider is what makes the server reachable, so
   * a failure here is worth a log line and nothing more.
   */
  const dropOwnMcpEntry = (): void => {
    for (const target of mcpConfigCandidates(storageDir, profileIds())) {
      if (!existsSync(target)) {
        continue
      }
      try {
        const text = readTextOrNull(target)
        const stripped = withoutMcpEntry(text)
        if (stripped === null) {
          if (mentionsOurServer(text)) {
            warn(`could not parse ${target}; our MCP entry stays in it`)
          }
          continue
        }
        writeFileSync(target, stripped, 'utf8')
        log(`removed our own MCP entry from ${target}; the server is provided in memory instead`)
      } catch (cause) {
        warn(`could not remove our own MCP entry from ${target}: ${String(cause)}`)
      }
    }
  }

  /**
   * Run the CLI's own `install`, which wires up the agents it supports.
   *
   * VS Code is not one of them any more as far as this extension is concerned:
   * the entry the CLI writes for it is removed again straight afterwards, and
   * the server this window uses comes from the definition provider.
   *
   * The state is resolved fresh rather than passed in: this runs straight
   * after a download, so any state captured before it is already stale and
   * would still report no binary.
   */
  const registerMcp = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const state = resolveState(ownedInstallPath())
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
      dropOwnMcpEntry()
      log(`ran ${state.activePath} install`)
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
    installPath: managedBinaryPath(homedir(), process.platform),
    systemRoot: process.env['SystemRoot'],
    // The steps of an install - the URL fetched, the path written - are detail.
    // What the user did and what came of it is logged at info by the caller.
    log: debug,
    onStep: report,
  })

  const handlers: Record<
    (typeof COMMAND_IDS)[number],
    (arg?: string, value?: string) => void | Promise<void>
  > = {
    'betterCmm.runSetup': async () => {
      const state = resolveState(ownedInstallPath())
      if (refuseIfExternal(state, 'Setup')) {
        return
      }

      const managed = managedBinaryPath(homedir(), process.platform)
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
        let tag: string
        try {
          // The Setup button turns into its own progress bar, so the percentage
          // goes there as well as into the notification.
          panel.setSetupProgress(0)
          ;({ tag } = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title },
            async (progress) =>
              installLatest({
                ...installDeps((id) => progress.report({ message: wizardStepTitle(id) })),
                onProgress: (percent) => {
                  panel.setSetupProgress(percent)
                },
              }),
          ))
        } catch (cause) {
          // Only a failure puts the button back: on success the setup screen is
          // replaced outright, and clearing it first flashes the button once.
          panel.setSetupProgress(null)
          throw cause
        }
        await context.globalState.update(
          OWNED_INSTALL_KEY,
          managedBinaryPath(homedir(), process.platform),
        )
        log(`setup installed ${tag}`)

        // Wiring the CLI's other agents is the second half of the same click.
        // VS Code itself needs nothing from it: the refresh below offers the
        // new binary through the definition provider.
        const registered = await registerMcp()
        await refresh()
        // The setup screen is gone with the install; drop the percentage so a
        // later one does not start from this one's 100.
        panel.setSetupProgress(null)

        if (registered.ok) {
          void vscode.window.showInformationMessage(
            `codebase-memory-mcp ${tag} installed and available as an MCP server.`,
          )
        } else {
          log(`setup: wiring the other agents failed: ${registered.error}`)
          // The server this window uses is provided, not installed, so this is
          // the other agents going unwired rather than a broken setup.
          void vscode.window
            .showWarningMessage(
              `codebase-memory-mcp ${tag} installed and available here, but ${wizardStepTitle(
                'register-mcp',
              ).toLowerCase()} failed.`,
              'View extension log',
            )
            .then((choice) => {
              if (choice === 'View extension log') {
                void vscode.commands.executeCommand('betterCmm.showLogs')
              }
            })
        }
      } catch (cause) {
        fail('Setup', cause)
      }
    },
    'betterCmm.copyUninstallCommand': async () => {
      // Bound to the resolved binary: the bare name only works when the CLI is
      // on PATH, and a managed install never is, so the copied command failed
      // with "not recognised" exactly for the users who had not installed it
      // themselves.
      await vscode.env.clipboard.writeText(
        uninstallCommandFor(resolveState(ownedInstallPath()).activePath),
      )
      void vscode.window.showInformationMessage(
        'Uninstall command copied. Run it in a terminal to remove codebase-memory-mcp itself.',
      )
    },
    'betterCmm.copyUninstallCommandBash': async () => {
      await vscode.env.clipboard.writeText(
        uninstallCommandForBash(resolveState(ownedInstallPath()).activePath),
      )
      void vscode.window.showInformationMessage('Uninstall command copied for Git Bash.')
    },
    'betterCmm.copyDaemonStopCommand': async () => {
      await vscode.env.clipboard.writeText(
        daemonStopCommandFor(resolveState(ownedInstallPath()).activePath),
      )
      void vscode.window.showInformationMessage(
        'Daemon stop command copied. Run it in a terminal, then refresh the panel.',
      )
    },
    'betterCmm.copyDaemonStopCommandBash': async () => {
      await vscode.env.clipboard.writeText(
        daemonStopCommandForBash(resolveState(ownedInstallPath()).activePath),
      )
      void vscode.window.showInformationMessage('Daemon stop command copied for Git Bash.')
    },
    'betterCmm.removeManagedBinary': async () => {
      const managed = managedBinaryPath(homedir(), process.platform)
      if (!existsSync(managed)) {
        return
      }
      const confirmed = await vscode.window.showWarningMessage(
        'Remove the binary this extension installed?',
        {
          modal: true,
          detail:
            `${managed}\n\n` +
            'Indexes are not touched. The MCP entry stays behind and will ' +
            'point at a binary that is gone, so run the uninstall command ' +
            'above if you want that removed too.',
        },
        'Remove',
      )
      if (confirmed !== 'Remove') {
        return
      }
      try {
        rmSync(managed, { force: true })
        // Drop the ownership record with the file, so a binary that later
        // reappears at this path is not mistaken for ours.
        await context.globalState.update(OWNED_INSTALL_KEY, undefined)
        log(`User: removed the managed binary at ${managed}`)
      } catch (cause) {
        fail('Removing the managed binary', cause)
        return
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
      debug('copying the binary folder')
      const active = resolveState(ownedInstallPath()).activePath
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
      const state = resolveState(ownedInstallPath())
      if (state.activePath === null) {
        return
      }
      // The key must be one the CLI itself reported. A webview message is not
      // a trustworthy source for something that becomes a CLI argument.
      const known = cliSettings.find((entry) => entry.key === key)
      if (known === undefined) {
        warn(`ignored unknown CLI setting: ${key}`)
        return
      }
      if (known.value === value) {
        debug(`CLI setting ${key} already ${value}; nothing written`)
        return
      }
      // Who, what, and from what to what. "panel: setCliSetting (auto_index)"
      // recorded that something happened to a key and nothing about the change
      // itself, which is the only part worth reading later.
      log(`User: CLI setting ${key} "${known.value}" -> "${value}"`)
      const result = await new CliClient(state.activePath, runProcess).setConfig(key, value)
      if (!result.ok) {
        warn(`CLI setting ${key} failed to change: ${result.error}`)
        fail(`Setting ${key}`, new Error(result.error))
      } else {
        debug(`CLI setting ${key} is now "${value}"`)
      }
      await refreshCliSettings()
    },
    'betterCmm.updateBinary': async () => {
      const state = resolveState(ownedInstallPath())
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

        let outcome: InstallResult
        try {
          // The panel's update button turns into its own progress bar, so the
          // percentage goes there as well as into the notification.
          panel.setUpdateProgress(0)
          outcome = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: wizardStepTitle('download-binary'),
            },
            async (progress) =>
              installRelease(latestTag, {
                ...installDeps((id) => progress.report({ message: wizardStepTitle(id) })),
                onProgress: (percent) => {
                  panel.setUpdateProgress(percent)
                },
              }),
          )
        } catch (cause) {
          // Only a failure puts the button back. Clearing it on the way out of
          // a successful update flashed "Update to x" for one frame before the
          // refresh below removed the button entirely.
          panel.setUpdateProgress(null)
          throw cause
        }
        log(`update installed ${latestTag} (was ${installed.value})`)
        // The running server is still the process started from the old binary,
        // and the toast saying so is collapsed by default. The panel is where
        // the user just clicked, so it says it too, until the server restarts.
        restartRequired = 'binary'
        // A daemon that survived the update refuses every client of the new
        // build, so nothing works until it is gone. The install itself is
        // fine, which is exactly why this has to be said: the panel would
        // otherwise report a finished update over a CLI that fails on every
        // call.
        daemonStopFailure = outcome.daemonStopError ?? null
        if (daemonStopFailure !== null) {
          warn(`the previous daemon could not be stopped: ${daemonStopFailure}`)
        }
        // The freshly resolved tag is now the installed one, so the cached
        // answer would otherwise keep offering an update that already happened.
        latestTagCache.set(latestTag)
        await refresh()
        // The button is gone with the offer; drop the percentage so the next
        // update does not start from the last one's 100.
        panel.setUpdateProgress(null)
        void vscode.window.showInformationMessage(
          `codebase-memory-mcp updated to ${latestTag}. Restart the MCP server ` +
            `(or reload the window) for the new binary to take effect.`,
        )
      } catch (cause) {
        fail('Update', cause)
      }
    },
    'betterCmm.addProject': async () => {
      log('User: add repositories (opening the folder picker)')
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: true,
        openLabel: 'Add repositories',
      })
      const state = resolveState(ownedInstallPath())
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
            if (result.ok) {
              log(
                `User: added "${folderName(folder.fsPath)}" (${folder.fsPath}): ` +
                  indexReport(result.value),
              )
            } else {
              // Silence here was the whole problem: indexing could fail on
              // every folder and the panel just stayed empty.
              failures.push(`${folder.fsPath}: ${result.error}`)
              warn(`User: adding "${folderName(folder.fsPath)}" (${folder.fsPath}) failed: ${result.error}`)
            }
          }
        },
      )
      if (failures.length > 0) {
        void vscode.window.showErrorMessage(
          `Could not index ${String(failures.length)} of ${String(picked.length)} repositories.`,
          'View extension log',
        ).then((choice) => {
          if (choice === 'View extension log') {
            void vscode.commands.executeCommand('betterCmm.showLogs')
          }
        })
      }
      await refresh()
      // The names the CLI derives are not known until the list comes back, so
      // the notes are written afterwards, matched by the root that was picked.
      for (const folder of picked) {
        const added = projects.find((project) => samePath(project.root_path, folder.fsPath))
        if (added !== undefined && indexRecords()[added.name] === undefined) {
          await rememberIndexed(added.name, await headCommit(added.root_path))
        }
      }
    },
    'betterCmm.removeProject': async (name) => {
      const state = resolveState(ownedInstallPath())
      if (name === undefined || state.activePath === null) {
        return
      }
      // `name` comes from the webview, which is filled from attacker-influenced
      // CLI JSON. Resolve it against the project list we fetched ourselves
      // rather than trusting it, so it can never become a raw CLI argument.
      const project = projects.find((p) => p.name === name)
      if (project === undefined) {
        warn(`ignored removeProject for unknown project: ${name}`)
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
      const result = await new CliClient(state.activePath, runProcess).removeProject(project.name)
      const label = folderName(project.root_path)
      if (result.ok) {
        // What was dropped is the only measure of the removal, and it is gone
        // from the next refresh onwards, so it is read from the last state.
        const freed = [
          typeof project.nodes === 'number' ? `${project.nodes.toLocaleString('en-US')} nodes` : null,
          typeof project.edges === 'number' ? `${project.edges.toLocaleString('en-US')} edges` : null,
        ].filter((part): part is string => part !== null)
        const dropped = freed.length === 0 ? '' : `: ${freed.join(', ')} dropped`
        log(`User: removed "${label}" (${project.root_path}) from the index${dropped}`)
      } else {
        warn(`User: removing "${label}" (${project.root_path}) failed: ${result.error}`)
      }
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
    'betterCmm.clearLog': async () => {
      // The log persists for the life of the installation now, and it carries
      // paths and project names, so there has to be a way to empty it that is
      // not 'find the file yourself'.
      const confirmed = await vscode.window.showWarningMessage(
        'Clear the extension log?',
        { modal: true, detail: logFile.path },
        'Clear',
      )
      if (confirmed !== 'Clear') {
        return
      }
      logFile.clear()
      log('User: cleared the extension log')
      void vscode.window.showInformationMessage('Extension log cleared.')
    },
    'betterCmm.showEngineLogs': async () => {
      // The engine writes one file per connected client plus one per indexing
      // worker, and the interesting one is whichever moved last - so they are
      // offered newest first rather than guessed at.
      const directory = engineLogDirectory(homedir())
      let entries: { label: string; description: string; path: string }[] = []
      try {
        entries = readdirSync(directory)
          .filter((name) => name.endsWith('.log'))
          .flatMap((name) => {
            const full = join(directory, name)
            let stats
            try {
              stats = statSync(full)
            } catch {
              // Rotated away between the listing and the stat; skip just this one.
              return []
            }
            const worker = name.startsWith('.worker-')
            return [{
              label: name,
              description: `${formatBytes(stats.size)}, ${stats.mtime.toLocaleString()}`,
              path: full,
              at: stats.mtimeMs,
              size: stats.size,
              // Client sessions first: a worker file only exists to capture a
              // crash, and is empty when there was none.
              group: worker ? 'Indexing workers' : 'Client sessions',
            }]
          })
          // Empty files are noise: they are workers that exited cleanly.
          .filter((entry) => entry.size > 0)
          .sort((a, b) => (a.group === b.group ? b.at - a.at : a.group < b.group ? -1 : 1))
      } catch (cause) {
        debug(`engine log directory unreadable: ${cause instanceof Error ? cause.message : ''}`)
      }
      if (entries.length === 0) {
        void vscode.window.showInformationMessage(
          `No engine logs yet. The CLI writes them to ${directory} once it runs.`,
        )
        return
      }
      const picked = await vscode.window.showQuickPick(entries, {
        title: 'Engine logs',
        // Said plainly: unlike the extension's own log, these are written by
        // the CLI and pass through no redaction before they are shown.
        placeHolder: 'Written by codebase-memory-mcp itself. Not redacted - check before sharing.',
      })
      if (picked === undefined) {
        return
      }
      log(`User: opening engine log ${picked.label}`)
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(picked.path))
        await vscode.window.showTextDocument(document, { preview: false })
      } catch (cause) {
        // An indexing worker's log is exactly the file large enough for the
        // editor to refuse it, and it may also have been rotated away between
        // the pick and the open. Either way the user gets told.
        fail(`Opening ${picked.label}`, cause)
      }
    },
    'betterCmm.openSettings': async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:smoochy.better-codebase-memory-mcp')
    },
    'betterCmm.reindexProject': async (name) => {
      const state = resolveState(ownedInstallPath())
      if (name === undefined || state.activePath === null) {
        return
      }
      // Resolve the name against the list the extension fetched itself, the
      // same rule removeProject uses: a webview message is not a trustworthy
      // source for something that becomes a CLI argument.
      const project = projects.find((entry) => entry.name === name)
      if (project === undefined) {
        warn(`ignored reindexProject for unknown project: ${name}`)
        return
      }
      if (inFlight.has(project.name)) {
        log(`User: reindex "${folderName(project.root_path)}" skipped, one is already running`)
        return
      }
      const client = new CliClient(state.activePath, runProcess, 300_000)
      inFlight.add(project.name)
      let result
      try {
        result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Reindexing ${project.name}` },
          async () => client.addProject(project.root_path),
        )
      } finally {
        inFlight.delete(project.name)
      }
      if (result.ok) {
        // Indexing is incremental: an unchanged repository comes back in under
        // a second and the store file is not touched, so "finished" on its own
        // was indistinguishable from nothing having happened. Report what the
        // CLI actually said, on the one line that also names who asked.
        const report = indexReport(result.value, { nodes: project.nodes, edges: project.edges })
        log(`User: reindex "${folderName(project.root_path)}" (${project.root_path}): ${report}`)
        await rememberIndexed(project.name, await headCommit(project.root_path))
        void vscode.window.showInformationMessage(`${project.name}: ${report}`)
      } else {
        warn(`User: reindex "${folderName(project.root_path)}" (${project.root_path}) failed: ${result.error}`)
        void vscode.window
          .showErrorMessage(`Could not reindex ${project.name}.`, 'View extension log')
          .then((choice) => {
            if (choice === 'View extension log') {
              void vscode.commands.executeCommand('betterCmm.showLogs')
            }
          })
      }
      await refresh()
    },
    'betterCmm.reindex': async () => {
      log('User: reindex all projects')
      const state = resolveState(ownedInstallPath())
      if (state.activePath === null || projects.length === 0) {
        return
      }
      // Re-running index_repository against a known root is what refreshes an
      // existing project; there is no separate reindex tool.
      const targets = projects.filter((project) => !inFlight.has(project.name))
      const client = new CliClient(state.activePath, runProcess, 300_000)
      const failures: string[] = []
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Reindexing projects' },
        async (progress) => {
          for (const [done, project] of targets.entries()) {
            progress.report({
              message: `${project.root_path} (${String(done + 1)}/${String(targets.length)})`,
            })
            // Re-checked per iteration: the filter above ran before any await,
            // so the auto-reindex timer can have claimed a project since.
            if (inFlight.has(project.name)) {
              continue
            }
            inFlight.add(project.name)
            let result
            try {
              result = await client.addProject(project.root_path)
            } finally {
              inFlight.delete(project.name)
            }
            if (result.ok) {
              log(
                `reindex "${project.name}": ` +
                  indexReport(result.value, { nodes: project.nodes, edges: project.edges }),
              )
              await rememberIndexed(project.name, await headCommit(project.root_path))
            } else {
              failures.push(project.root_path)
              log(`reindex failed for ${project.root_path}: ${result.error}`)
            }
          }
        },
      )
      if (failures.length > 0) {
        void vscode.window
          .showErrorMessage(
            `Could not reindex ${String(failures.length)} of ${String(targets.length)} projects.`,
            'View extension log',
          )
          .then((choice) => {
            if (choice === 'View extension log') {
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

  // A webview view only exists once the user has opened it, and `badge` lives
  // on that object, so the activity bar could not report an update until the
  // panel had been clicked at least once - the one moment the badge is not
  // needed. A tree view exists from creation, so this empty one carries the
  // badge instead. It stays hidden behind its `when` clause, which is also
  // what keeps the sidebar to a single visible view.
  const badgeView = vscode.window.createTreeView(PanelProvider.updateViewType, {
    treeDataProvider: { getChildren: () => [], getTreeItem: (item: never) => item },
  })
  context.subscriptions.push(badgeView)
  panel.onBadgeChange((badge) => {
    badgeView.badge = badge
    void vscode.commands.executeCommand(
      'setContext',
      'betterCmm.updateAvailable',
      badge !== undefined,
    )
  })

  /**
   * Reindex what the checkout has moved past, if the user asked for it.
   *
   * This watches commits, not files. A `**\/*` FileSystemWatcher over every
   * indexed root - what the predecessor extension did - is what produced the
   * constant re-indexing this project set out to stop, and it costs a native
   * watcher per repository including their `node_modules`. Comparing the head
   * commit against the one each index was built from costs nothing beyond the
   * project list already being fetched, and it is exactly the case that goes
   * unnoticed today: a pull that moves the checkout out from under the index.
   * Edits that are not yet committed are not covered.
   */
  const autoReindexTick = async (): Promise<void> => {
    if (!setting('autoReindex', false)) {
      return
    }
    const state = resolveState(ownedInstallPath())
    if (state.activePath === null) {
      return
    }
    // The panel may be hidden, and then nothing else has refreshed the list.
    await refresh()
    const due = projects.filter(
      (project) => project.stale === true && !inFlight.has(project.name),
    )
    debug(
      `Auto Reindex: checked ${String(projects.length)} project(s), ${String(due.length)} to reindex`,
    )
    if (due.length === 0) {
      return
    }
    const client = new CliClient(state.activePath, runProcess, 300_000)
    for (const project of due) {
      // Re-checked here, not only when `due` was built: every iteration awaits,
      // and a manual reindex or the next tick can claim a project in between.
      // A single index may run for minutes while the interval floor is 30s.
      if (inFlight.has(project.name)) {
        continue
      }
      inFlight.add(project.name)
      try {
        const result = await client.addProject(project.root_path)
        if (result.ok) {
          log(
            `Auto Reindex: "${folderName(project.root_path)}" (${project.root_path}): ` +
              indexReport(result.value, { nodes: project.nodes, edges: project.edges }),
          )
          await rememberIndexed(project.name, await headCommit(project.root_path))
        } else {
          // A root that was deleted or unmounted fails here every tick. It is
          // logged and skipped; one broken repository must not stop the rest.
          warn(`Auto Reindex: "${folderName(project.root_path)}" failed: ${result.error}`)
        }
      } catch (cause) {
        warn(`Auto Reindex: "${folderName(project.root_path)}" threw: ${cause instanceof Error ? cause.message : String(cause)}`)
      } finally {
        inFlight.delete(project.name)
      }
    }
    await refresh()
  }

  // One tick at a time: a single index may take minutes, far longer than the
  // interval floor, and a second tick would start on the same repositories.
  let ticking = false
  let autoReindexTimer: NodeJS.Timeout | undefined

  /**
   * (Re)arm both timers from the settings as they stand now.
   *
   * Called again whenever the settings change, because reading them once at
   * activation meant switching auto reindex on did nothing at all until the
   * window was reloaded - it looked exactly like a broken feature.
   */
  const armTimers = (): void => {
    if (autoReindexTimer !== undefined) {
      clearInterval(autoReindexTimer)
      autoReindexTimer = undefined
    }
    if (refreshTimer !== undefined) {
      clearInterval(refreshTimer)
      refreshTimer = undefined
    }

    if (setting('autoReindex', false)) {
      const seconds = numberSetting('autoReindexIntervalSeconds', 300, 30, 3600)
      debug(`Auto Reindex: armed, checking every ${String(seconds)}s`)
      autoReindexTimer = setInterval(() => {
        if (ticking) {
          debug('Auto Reindex: previous check still running, skipping this one')
          return
        }
        ticking = true
        // Nothing here may throw out of the callback: an unhandled rejection in
        // a timer takes the whole loop down and auto reindex silently stops.
        void autoReindexTick()
          .catch((cause: unknown) => {
            warn(
              `Auto Reindex: check failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          })
          .finally(() => {
            ticking = false
          })
      }, seconds * 1000)
    }

    // Polling only, no FileSystemWatcher: the CLI watches files itself.
    if (setting('autoRefresh', true)) {
      const seconds = numberSetting('refreshIntervalSeconds', 30, 5, 3600)
      refreshTimer = setInterval(() => {
        if (panel.isVisible && !panel.isOnSubScreen) {
          void refresh()
        } else {
          // Deliberately not a full refresh: the CLI calls and their log lines
          // stop while the panel is hidden. The release lookup is a cached
          // network call, and it is the only way an update lands on the
          // activity bar in a window whose panel is never opened.
          void updateBadgeCheck()
        }
      }, seconds * 1000)
    }
  }

  rearmTimers = armTimers
  armTimers()
  context.subscriptions.push({
    dispose: () => {
      if (autoReindexTimer !== undefined) {
        clearInterval(autoReindexTimer)
        autoReindexTimer = undefined
      }
      if (refreshTimer !== undefined) {
        clearInterval(refreshTimer)
        refreshTimer = undefined
      }
    },
  })

  // Settings Sync can deliver an entry written on another machine to a host
  // that never runs Setup again, so the cleanup runs on the way in as well as
  // after `install`.
  dropOwnMcpEntry()

  void refresh()

  // Surfaced as `extension.exports`, which every installed extension can
  // read. The panel markup holds nothing a co-installed extension could not
  // already read from disk, but this exists only so the integration suite can
  // assert on what the running host rendered, so it stays out of production
  // rather than widening the exported surface for no user-facing reason.
  return context.extensionMode === vscode.ExtensionMode.Production
    ? {}
    : {
        panelHtmlForTests: () => panel.renderedHtml,
        updateChecksForTests: () => updateChecks,
      }
}

export function deactivate(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
}
