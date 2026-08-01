import { upstreamRepoUrl } from '../binary/assets'
import { uninstallCommandFor, uninstallCommandForBash } from '../constants'
import type { ProjectSummary } from '../cli/client'
import { optionsFromDescription, type CliSetting } from '../cli/configParse'
import { allowedActions, type ExtensionState } from '../state/machine'

export interface PanelModel {
  state: ExtensionState
  projects: ProjectSummary[]
  /** Version of the CLI binary. */
  version: string | null
  /** Version of this extension, read from its own manifest. */
  extensionVersion?: string | null
  /** Version string when a newer release exists, otherwise null. */
  updateAvailable: string | null
  /**
   * True between activation and the first completed CLI call. The binary takes
   * seconds to start, so the panel renders a skeleton in the meantime rather
   * than staying blank and reading as a hang.
   */
  loading?: boolean
  /** Which screen the panel shows. Anything but `main` replaces the whole view. */
  view?: 'main' | 'settings'
  /** True after registering, until the window reloads and the entry takes effect. */
  restartRequired?: boolean
  /** CLI settings from `config list`, shown on the settings screen. */
  cliSettings?: CliSetting[]
  /** Host platform, so the uninstall block offers the right shell. */
  platform?: NodeJS.Platform
  /** True when a Git Bash shell was found, which gets its own command line. */
  gitBashAvailable?: boolean
  /** True when the extension has its own copy of the binary to remove. */
  managedBinaryPresent?: boolean
}

/**
 * Every value that reaches the markup passes through here.
 *
 * `&` must be replaced first: any later rule emits entities that start with
 * `&`, so escaping `&` afterwards would double-escape them.
 *
 * The backtick is escaped even though every interpolation site below sits in a
 * double-quoted attribute or in text. It costs one pass and removes the whole
 * class of bugs where a later edit moves a value into an unquoted attribute or
 * a template literal.
 */
export function escapeHtml(value: string): string {
  // The CLI's JSON is cast, not validated, so a malformed payload can put a
  // non-string here at runtime. Coerce rather than throw: a broken name must
  // not take down the whole panel render.
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
}

/** Thousands separators, and a dash for "nothing to report yet". */
export function formatCount(value: number | undefined): string {
  return value === undefined || value <= 0 ? '-' : value.toLocaleString('en-US')
}

/**
 * Index size for the metric card. Binary units, one decimal above a kilobyte,
 * because a graph store crosses from KB to GB and a raw byte count is unreadable
 * at either end.
 */
export function formatBytes(value: number | undefined): string {
  if (value === undefined || value <= 0) {
    return '-'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${unit === 0 ? String(size) : size.toFixed(1)} ${units[unit]}`
}

/** Sum one numeric field across every project, for the header totals. */
function total(projects: ProjectSummary[], field: 'nodes' | 'edges' | 'size_bytes'): number {
  return projects.reduce((sum, project) => sum + (project[field] ?? 0), 0)
}

type Tone = 'neutral' | 'primary' | 'danger'

/** Inline icons. Drawn on a 16-unit grid so every path shares one scale. */
const ICONS: Record<string, string> = {
  download: '<path d="M8 2v7.5m0 0L5.2 6.7M8 9.5l2.8-2.8M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  link: '<path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l1.9-1.9a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.8 8.5a2.6 2.6 0 0 0 3.7 3.7l.9-.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 5.5v-1a1.4 1.4 0 0 0-1.4-1.4H3.9A1.4 1.4 0 0 0 2.5 4.5v5.2a1.4 1.4 0 0 0 1.4 1.4h1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  arrowUp: '<path d="M8 13V4m0 0L4.8 7.2M8 4l3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  logs: '<path d="M3.5 4h9M3.5 7h6M3.5 10h9M3.5 13h4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  // Reindex rebuilds the stored graph, so it reads as a database rather than a
  // second refresh arrow - two identical arrows side by side are a coin toss.
  reindex: '<ellipse cx="8" cy="4" rx="4.6" ry="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.4 4v8c0 1 2.1 1.8 4.6 1.8s4.6-.8 4.6-1.8V4M3.4 8c0 1 2.1 1.8 4.6 1.8s4.6-.8 4.6-1.8" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  trash: '<path d="M2.8 4.4h10.4M6.2 4.4V3.2a.9.9 0 0 1 .9-.9h1.8a.9.9 0 0 1 .9.9v1.2M4.3 4.4v8a1.2 1.2 0 0 0 1.2 1.2h5a1.2 1.2 0 0 0 1.2-1.2v-8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  gear: '<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  back: '<path d="M10 3l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
}

function icon(name: keyof typeof ICONS | string): string {
  const path = ICONS[name] ?? ''
  return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${path}</svg>`
}

function button(command: string, label: string, iconName: string, tone: Tone = 'neutral'): string {
  // The icon is inside the button, so a click can land on the <svg> or its
  // <path> instead of the button. `pointer-events: none` on .icon (see CSS)
  // keeps event.target the button itself, which is what the handler reads.
  return (
    `<button class="action ${tone}" data-command="${escapeHtml(command)}">` +
    `${icon(iconName)}<span>${escapeHtml(label)}</span>` +
    '</button>'
  )
}

function notice(kind: 'info' | 'warning', text: string): string {
  return `<p class="notice ${kind}">${escapeHtml(text)}</p>`
}

function section(title: string, body: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`
}

function metrics(projects: ProjectSummary[]): string {
  const cards = [
    { value: formatCount(total(projects, 'nodes')), label: 'Nodes' },
    { value: formatCount(total(projects, 'edges')), label: 'Edges' },
    // Projects, per the spec: it replaces the reference extension's Uptime
    // tile, which was always empty. Index size stays visible per project.
    { value: formatCount(projects.length), label: 'Projects' },
  ]
    .map(
      (card) =>
        '<div class="metric">' +
        `<div class="metric-value">${escapeHtml(card.value)}</div>` +
        `<div class="metric-label">${escapeHtml(card.label)}</div>` +
        '</div>',
    )
    .join('')
  return `<div class="metrics">${cards}</div>`
}

/**
 * The header status reflects MCP registration, not a server process.
 *
 * The extension does not own the server lifecycle - the CLI's own `install`
 * subcommand registers it and VS Code starts it - so there is no running or
 * stopped state here to report honestly.
 */
function statusChip(state: ExtensionState): string {
  const [tone, label] =
    state.kind === 'needs-setup'
      ? ['idle', 'no binary']
      : state.kind === 'binary-not-registered'
        ? ['warn', 'not registered']
        : ['ok', 'registered']
  return `<span class="chip ${tone}"><span class="chip-dot"></span>${escapeHtml(label)}</span>`
}

/**
 * The two versions in the sub-title: the CLI's, then this extension's.
 *
 * The CLI version carries the binary's path as its tooltip. That is the only
 * place the path appears now - a full path is too long for a panel this narrow
 * and was previously truncated into uselessness on its own row.
 */
function subVersions(model: PanelModel): string {
  const parts: string[] = []

  if (model.version !== null) {
    const path = model.state.activePath
    const hint =
      path === null
        ? 'Path unknown'
        : `${path}${
            model.state.effectiveSource === null ? '' : ` (${model.state.effectiveSource})`
          }\nClick to copy the folder`
    // A button, not a span: the path is worth having in the clipboard, and a
    // tooltip is the one thing you cannot copy out of.
    parts.push(
      `<button class="ver" data-command="betterCmm.copyBinaryDir" title="${escapeHtml(hint)}">` +
        `v${escapeHtml(model.version)}</button>`,
    )
  }

  if (model.extensionVersion !== null && model.extensionVersion !== undefined) {
    parts.push(`<span class="nowrap">VSC Extension · v${escapeHtml(model.extensionVersion)}</span>`)
  }

  return parts.length === 0 ? '' : ` · ${parts.join(' · ')}`
}

function header(model: PanelModel): string {
  return (
    '<header>' +
    '<div class="brand">' +
    '<span class="mark">' +
    '<svg viewBox="0 0 20 20" aria-hidden="true">' +
    '<path d="M10 3.2 16 6.6v6.8L10 16.8 4 13.4V6.6Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<circle cx="10" cy="10" r="2.1" fill="currentColor"/>' +
    '<path d="M10 3.2v4.7M16 6.6l-4 2.4M4 13.4l4-2.4M10 16.8v-4.7" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
    '</svg>' +
    '</span>' +
    '<span class="brand-text">' +
    '<span class="brand-name">Codebase Memory</span>' +
    `<span class="brand-sub">Knowledge Graph Engine${subVersions(model)}</span>` +
    '</span>' +
    '</div>' +
    statusChip(model.state) +
    '</header>'
  )
}

/**
 * Only the missing-binary warning now.
 *
 * The version and path row it used to render is gone: the version sits in the
 * sub-title and the path is that version's tooltip, so repeating either here
 * would just cost a line of a narrow panel.
 */
function binaryBar(model: PanelModel): string {
  if (model.state.kind !== 'needs-setup') {
    return ''
  }
  return '<div class="bar"><span class="tag err">!</span>No binary found - run setup to get started</div>'
}

function projectCards(projects: ProjectSummary[], loading: boolean): string {
  if (loading) {
    // Three placeholder bars, so the panel has its final shape before the CLI
    // answers rather than appearing empty and broken.
    return '<div class="card skeleton"><span class="sk sk-1"></span><span class="sk sk-2"></span></div>'
  }
  if (projects.length === 0) {
    return '<p class="empty">No projects indexed yet.</p>'
  }

  return projects
    .map((project) => {
      const name = escapeHtml(project.name)
      return (
        '<div class="card">' +
        '<div class="card-head">' +
        '<span class="dot"></span>' +
        '<div class="card-text">' +
        // The folder is what the user recognises. The CLI's own name is the
        // whole path with separators turned into hyphens, which is unreadable
        // at this width and repeats the line below it - it moves to the
        // tooltip, where it is still available for the CLI commands that need
        // it verbatim.
        `<div class="card-name" title="${escapeHtml(`Project name: ${project.name}`)}">` +
        `${escapeHtml(folderName(project.root_path))}</div>` +
        `<div class="card-path" title="${escapeHtml(project.root_path)}">` +
        `${escapeHtml(parentPath(project.root_path))}</div>` +
        '</div>' +
        '<span class="card-tools">' +
        // Re-running the index for one project, without touching the others.
        `<button class="card-tool" title="Reindex this repository now. Rescans its files and ` +
        `rebuilds its part of the graph; nothing else is touched." ` +
        `aria-label="Reindex ${name}" ` +
        `data-command="betterCmm.reindexProject" data-project="${name}">${icon('reindex')}</button>` +
        `<button class="card-tool danger" title="Remove from index" aria-label="Remove ${name} from the index" ` +
        `data-command="betterCmm.removeProject" data-project="${name}">${icon('trash')}</button>` +
        '</span>' +
        '</div>' +
        '<div class="card-stats">' +
        `<span>${escapeHtml(formatCount(project.nodes))} <em>nodes</em></span>` +
        '<span class="sep">·</span>' +
        `<span>${escapeHtml(formatCount(project.edges))} <em>edges</em></span>` +
        // Size and branch per the spec. Both are omitted rather than shown as
        // a dash when the CLI does not report them, so a non-git checkout does
        // not carry an empty-looking field.
        (project.size_bytes === undefined
          ? ''
          : '<span class="sep">·</span>' +
            `<span>${escapeHtml(formatBytes(project.size_bytes))}</span>`) +
        (typeof project.git?.branch === 'string' && project.git.branch.length > 0
          ? '<span class="sep">·</span>' + branchTag(project.git.branch)
          : '') +
        '</div>' +
        freshness(project) +
        '</div>'
      )
    })
    .join('')
}

/**
 * Path helpers that tolerate a payload the CLI should not have sent.
 *
 * `listProjects` filters non-string paths out, but these must not be the one
 * place a malformed payload can still throw the whole render.
 */
function trimmedPath(rootPath: string): string {
  return typeof rootPath === 'string' ? rootPath.replace(/[\\/]+$/, '') : ''
}

/** Relative age, because "3 hours ago" answers the question a date makes you do arithmetic for. */
export function relativeTime(thenMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000))
  if (seconds < 90) {
    return 'just now'
  }
  const steps: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
  ]
  let unit = 'minute'
  let size = 60
  for (const [step, label] of steps) {
    if (seconds >= step) {
      unit = label
      size = step
    }
  }
  const count = Math.round(seconds / size)
  return `${String(count)} ${unit}${count === 1 ? '' : 's'} ago`
}

/**
 * When the index was last built, and whether it still matches the working tree.
 *
 * The CLI reports no timestamp, so the age comes from the store file it writes
 * per project. Staleness is the more useful half: `detect_changes` counts the
 * files that moved since, which answers "is this current" without the user
 * having to reason about a date.
 */
function freshness(project: ProjectSummary): string {
  const parts: string[] = []
  if (typeof project.indexed_at_ms === 'number' && Number.isFinite(project.indexed_at_ms)) {
    parts.push(`indexed ${escapeHtml(relativeTime(project.indexed_at_ms, Date.now()))}`)
  }
  if (typeof project.changed_count === 'number' && project.changed_count > 0) {
    const files = project.changed_count === 1 ? 'file' : 'files'
    parts.push(
      `<span class="stale" title="Reindex to pick these up">` +
        `${escapeHtml(String(project.changed_count))} ${files} changed since</span>`,
    )
  }
  return parts.length === 0 ? '' : `<div class="card-age">${parts.join(' · ')}</div>`
}

/** The last path segment - what the user actually calls the repository. */
function folderName(rootPath: string): string {
  const trimmed = trimmedPath(rootPath)
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] ?? trimmed
}

/** Everything above the folder, so the two lines do not repeat each other. */
function parentPath(rootPath: string): string {
  const trimmed = trimmedPath(rootPath)
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut <= 0 ? trimmed : trimmed.slice(0, cut)
}

/**
 * The git branch, with an explanation attached.
 *
 * `DETACHED` in particular reads as an error to anyone who has not met a
 * detached HEAD before, so it says what it means rather than assuming.
 */
function branchTag(branch: string): string {
  const hint =
    branch === 'DETACHED'
      ? 'Git: no branch checked out (detached HEAD) - the index follows this exact commit'
      : `Git branch indexed: ${branch}`
  return `<span class="branch" title="${escapeHtml(hint)}">${escapeHtml(branch)}</span>`
}

/**
 * The only script the panel ships. Built here so no caller can emit a script
 * tag without the nonce - every `renderBody` return path goes through this.
 */
function clickHandlerScript(nonce: string): string {
  return `<script nonce="${escapeHtml(nonce)}">
const vscode = acquireVsCodeApi()
document.addEventListener('click', (event) => {
  const target = event.target
  // Element, not HTMLElement: every button carries an inline <svg> icon, and
  // an SVG node is an SVGElement, so an HTMLElement guard silently dropped
  // every click that landed on an icon.
  if (!(target instanceof Element)) return
  const button = target.closest('[data-command]')
  if (!(button instanceof HTMLElement)) return
  const command = button.dataset.command
  if (command === undefined) return
  vscode.postMessage({ command, project: button.dataset.project })
})
// Settings write on commit rather than on every keystroke: change fires on
// blur or Enter for a text field, and immediately for a select.
document.addEventListener('change', (event) => {
  const target = event.target
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return
  const key = target.dataset.setting
  if (key === undefined) return
  vscode.postMessage({ command: 'betterCmm.setCliSetting', project: key, value: target.value })
})
</script>`
}

/**
 * The uninstall screen, shown in place of the panel rather than as a dialog.
 *
 * The extension deliberately does not run this command: `uninstall` asks
 * interactively whether to delete existing indexes and removes the binary
 * itself, so both decisions stay visibly with the user in their own terminal.
 */
/** One command line with its own copy button, so the right one is one click away. */
function commandLine(label: string, command: string, copyCommand: string): string {
  return (
    '<div class="cmd-row">' +
    `<div class="cmd-label">${escapeHtml(label)}</div>` +
    `<pre class="cmd"><code>${escapeHtml(command)}</code></pre>` +
    `<div class="actions">${button(copyCommand, 'Copy command', 'copy')}</div>` +
    '</div>'
  )
}

/**
 * The uninstall block, rendered inside the settings screen.
 *
 * The extension deliberately does not run the CLI's own uninstall: it asks
 * interactively whether to delete existing indexes and removes the binary
 * itself, so both decisions stay visibly with the user in their own terminal.
 * Removing the copy the extension itself installed is a different matter - it
 * owns that one, so it offers to do it.
 */
function uninstallBlock(model: PanelModel): string {
  const active = model.state.activePath
  const windows = model.platform === 'win32'

  const lines = windows
    ? commandLine('PowerShell', uninstallCommandFor(active, 'win32'), 'betterCmm.copyUninstallCommand') +
      (model.gitBashAvailable === true
        ? commandLine(
            'Git Bash',
            uninstallCommandForBash(active),
            'betterCmm.copyUninstallCommandBash',
          )
        : '')
    : commandLine('Terminal', uninstallCommandFor(active, 'linux'), 'betterCmm.copyUninstallCommand')

  return (
    '<p class="lead">Removing the CLI also removes its MCP registration, so no ' +
    'editor keeps pointing at a binary that is gone. Run it yourself in a ' +
    'terminal: it asks whether to delete the indexes it built, and that answer ' +
    'should be yours.</p>' +
    lines +
    (model.managedBinaryPresent === true
      ? '<p class="lead">The binary this extension installed is its own to ' +
        'remove, so it can do that for you without a terminal. That leaves the ' +
        'MCP entry behind, which is what the command above clears.</p>' +
        `<div class="actions">${button(
          'betterCmm.removeManagedBinary',
          'Remove the installed binary',
          'trash',
          'danger',
        )}</div>`
      : '') +
    '<p class="footnote">Uninstalling the CLI does not remove this extension, ' +
    'and removing the extension does not remove the CLI.</p>'
  )
}

/**
 * One CLI setting as a labelled control.
 *
 * A boolean gets a two-option select rather than free text, because the CLI
 * accepts only `true` and `false` and a typo is otherwise only discovered when
 * the write fails.
 */
function settingRow(setting: CliSetting): string {
  const isBoolean = setting.value === 'true' || setting.value === 'false'
  // Booleans are known without asking; anything else may still name its
  // choices in the CLI's own description, which turns it into a picker too.
  const described = isBoolean ? [] : optionsFromDescription(setting.description)
  const options = isBoolean ? ['true', 'false'] : described
  // The current value belongs in the list even when the description missed it,
  // so opening the picker can never silently change the setting.
  const choices = options.includes(setting.value) ? options : [...options, setting.value]

  const control =
    options.length > 0
      ? `<select class="ctl" data-setting="${escapeHtml(setting.key)}">` +
        choices
          .map(
            (option) =>
              `<option value="${escapeHtml(option)}"${setting.value === option ? ' selected' : ''}>` +
              `${escapeHtml(option)}</option>`,
          )
          .join('') +
        '</select>'
      : `<input class="ctl" type="text" data-setting="${escapeHtml(setting.key)}" ` +
        `value="${escapeHtml(setting.value)}">`

  const modified = setting.default !== '' && setting.value !== setting.default
  return (
    '<div class="setting">' +
    `<label class="setting-key">${escapeHtml(setting.key)}` +
    (modified
      ? `<span class="badge" title="${escapeHtml(`Default: ${setting.default}`)}">modified</span>`
      : '') +
    '</label>' +
    control +
    (setting.description === ''
      ? ''
      : `<p class="setting-desc">${escapeHtml(setting.description)}</p>`) +
    '</div>'
  )
}

/**
 * The settings screen.
 *
 * VS Code's own settings UI can only render static declarations, so the CLI's
 * own keys - which are discovered at runtime from `config list` - could never
 * appear there. Both live here instead, with the destructive action last and
 * visually separated.
 */
function settingsScreen(model: PanelModel, nonce: string): string {
  const cliSettings = model.cliSettings ?? []
  return (
    '<main>' +
    header(model) +
    section(
      'Extension',
      '<p class="lead">These belong to the extension and are stored by VS Code.</p>' +
        `<div class="actions">${button(
          'betterCmm.openSettings',
          'Open extension settings',
          'gear',
        )}</div>`,
    ) +
    section(
      'Engine',
      '<p class="lead">These belong to the CLI itself and apply to every editor ' +
        'that uses it, not just this window.</p>' +
        (cliSettings.length === 0
          ? '<p class="empty">No CLI settings available - is the binary installed?</p>'
          : cliSettings.map(settingRow).join('')),
    ) +
    // Inline rather than a link to a separate screen: this is the last thing
    // on the page anyway, and a second navigation step to read three lines is
    // a step that earns nothing.
    '<section class="danger">' +
    '<h2>Uninstall</h2>' +
    uninstallBlock(model) +
    '</section>' +
    `<div class="actions">${button('betterCmm.closeScreen', 'Back', 'back')}</div>` +
    '</main>' +
    clickHandlerScript(nonce)
  )
}

/** Header, notices, actions, project list. Static markup, no framework. */
export function renderBody(model: PanelModel, nonce: string): string {
  const { state } = model
  if (model.view === 'settings') {
    return settingsScreen(model, nonce)
  }
  const actions = allowedActions(state)
  const loading = model.loading === true
  const parts: string[] = [header(model), binaryBar(model)]

  if (state.kind === 'needs-setup') {
    // Both steps are named before the button is pressed. "Install binary" said
    // nothing about where the download comes from or that an MCP entry gets
    // written, so the release it fetches is linked right here.
    parts.push(
      section(
        'Actions',
        `<div class="actions">${button('betterCmm.runSetup', 'Setup', 'download', 'primary')}</div>` +
          '<ul class="steps">' +
          '<li>Installs the binary from ' +
          `<a href="${escapeHtml(upstreamRepoUrl())}">the upstream project</a></li>` +
          '<li>Registers it as an MCP server</li>' +
          '</ul>',
      ),
    )
    return `<main>${parts.join('')}</main>` + clickHandlerScript(nonce)
  }

  parts.push(metrics(model.projects))

  if (state.notice !== null) {
    parts.push(notice('info', state.notice))
  }

  if (state.pathConflict !== null) {
    parts.push(
      notice(
        'warning',
        `The MCP entry points at ${state.pathConflict.entryPath}, but the active binary is ${state.pathConflict.activePath}.`,
      ),
    )
  }

  if (state.kind === 'binary-not-registered') {
    parts.push(notice('warning', 'The binary is not registered as an MCP server.'))
  }

  // Registering only takes effect once the extension host restarts, so saying
  // it succeeded without saying that would leave the user looking for a server
  // that is not there yet.
  if (model.restartRequired === true) {
    parts.push(
      notice(
        'warning',
        'Reload VS Code to finish registering the MCP server - it is not reachable until then.',
      ),
    )
  }

  const buttons: string[] = []
  if (actions.showInstallButton) {
    buttons.push(button('betterCmm.installCli', 'Register MCP server', 'link', 'primary'))
  }
  if (actions.showClipboardHint) {
    parts.push(
      notice(
        'info',
        'This binary is not managed by the extension, so the extension does not modify it. ' +
          'Run the register command yourself to finish setup.',
      ),
    )
    buttons.push(button('betterCmm.copyInstallCommand', 'Copy register command', 'copy', 'primary'))
  }
  if (actions.showUpdateButton && model.updateAvailable !== null) {
    buttons.push(
      button('betterCmm.updateBinary', `Update to ${model.updateAvailable}`, 'arrowUp', 'primary'),
    )
  }
  // Anything above this point is a one-off call to action - registering,
  // updating - and keeps a full-width row of its own. Below it the actions are
  // grouped by what they act on, two to a row.
  const projectActions = [button('betterCmm.addProject', 'Add repositories', 'plus')]
  // Reindexing only makes sense once something is indexed; offering it against
  // an empty list would be a button that provably does nothing.
  if (model.projects.length > 0) {
    projectActions.push(button('betterCmm.reindex', 'Reindex all projects', 'reindex'))
  }
  // No Refresh button here: the title bar already has one, running the same
  // command, and two identical controls in one view only raise the question of
  // how they differ.
  const logActions = [
    button('betterCmm.showLogs', 'View extension log', 'logs'),
    button('betterCmm.showEngineLogs', 'View engine logs', 'logs'),
  ]

  parts.push(
    section(
      'Actions',
      (buttons.length === 0 ? '' : `<div class="actions">${buttons.join('')}</div>`) +
        `<div class="actions grid">${projectActions.join('')}</div>` +
        `<div class="actions grid">${logActions.join('')}</div>`,
    ),
  )
  parts.push(section('Projects', projectCards(model.projects, loading)))

  return `<main>${parts.join('')}</main>` + clickHandlerScript(nonce)
}

/**
 * Panel styling.
 *
 * Surfaces, text and borders come from VS Code's own theme variables, so the
 * panel follows a light theme instead of forcing a dark palette onto it. Only
 * the status hues are fixed: green/amber/red have to keep meaning the same
 * thing regardless of theme, and each is used at low alpha over the theme's
 * own background.
 */
export const PANEL_CSS = `
:root {
  /* Status hues as RGB triplets, so each one can be used both solid and as a
     low-alpha wash without a second variable per colour. */
  --ok-rgb: 46, 163, 106;
  --warn-rgb: 201, 138, 27;
  --err-rgb: 214, 69, 69;
  --accent-rgb: 61, 139, 205;
  --ok: rgb(var(--ok-rgb));
  --warn: rgb(var(--warn-rgb));
  --err: rgb(var(--err-rgb));
  --accent: rgb(var(--accent-rgb));
  /*
   * Surfaces are neutral overlays, so one set of rules reads correctly on a
   * dark and a light theme alike: white lifts a dark background, black settles
   * a light one, and the body.vscode-light rule below flips --tint to suit.
   *
   * Deliberately not color-mix() on --vscode-foreground: the theme variable is
   * an opaque colour, and mixing it toward the transparent keyword drags the
   * result toward transparent black, which renders every card invisible on a
   * dark theme. Plain rgba overlays have no such trap and need no fallback.
   */
  --tint: 255, 255, 255;
  --surface: rgba(var(--tint), .04);
  --surface-hi: rgba(var(--tint), .09);
  --line: rgba(var(--tint), .11);
  --line-hi: rgba(var(--tint), .22);
  --muted: var(--vscode-descriptionForeground);
  --r: 6px;
}
/*
 * VS Code puts one of these classes on the webview's body, which is the only
 * reliable signal for theme polarity inside a webview - prefers-color-scheme
 * follows the OS, not the editor theme, so a dark VS Code on a light desktop
 * would otherwise get the wrong overlay.
 */
body.vscode-light, body.vscode-high-contrast-light { --tint: 0, 0, 0; }
body.vscode-light .action.primary, body.vscode-high-contrast-light .action.primary { color: color-mix(in srgb, var(--ok) 75%, #000); }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: transparent;
  padding-bottom: 18px;
  -webkit-font-smoothing: antialiased;
}
header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 14px 12px 10px;
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mark {
  width: 30px; height: 30px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px; color: var(--accent);
  background: rgba(var(--accent-rgb), .14);
}
.mark svg { width: 18px; height: 18px; }
.brand-text { display: flex; flex-direction: column; min-width: 0; }
.brand-name { font-size: 13px; font-weight: 700; line-height: 1.25; }
.brand-sub { font-size: 10px; color: var(--muted); }
/* The dotted underline is the only cue that this version carries the path. */
.ver { border-bottom: 1px dotted currentColor; cursor: help; }
/* The sub-title wraps in a narrow sidebar; each label stays whole when it does. */
.nowrap { white-space: nowrap; }
.steps {
  margin: 8px 0 0; padding: 0 12px 0 26px; list-style: disc;
  font-size: 11px; color: var(--muted); line-height: 1.6;
}
.steps a { color: var(--accent); }
.lead { margin: 0 12px 10px; font-size: 12px; line-height: 1.55; }
/* The command is selectable text, so it can be copied by hand as well. */
.cmd {
  margin: 0 12px 10px; padding: 9px 10px; border-radius: var(--r);
  background: var(--surface); border: 1px solid var(--line);
  font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
  white-space: pre-wrap; word-break: break-all; user-select: text;
}
.footnote { margin: 10px 12px 0; font-size: 10px; color: var(--muted); line-height: 1.5; }
.cmd-row { margin-bottom: 10px; }
.cmd-label {
  margin: 0 12px 3px; font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .07em; color: var(--muted);
}
.cmd-row .cmd { margin-bottom: 5px; }
/* Two to a row, thematically grouped. auto-fit keeps a single action full
   width rather than leaving half the row empty. */
.actions.grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px;
}
.actions.grid .action { margin: 0; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  padding: 3px 9px; border-radius: 999px;
  font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  white-space: nowrap;
}
.chip-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chip.ok   { color: var(--ok);   background: rgba(var(--ok-rgb), .14); }
.chip.warn { color: var(--warn); background: rgba(var(--warn-rgb), .14); }
.chip.idle { color: var(--muted); background: var(--surface); }
.bar {
  display: flex; align-items: center; gap: 8px;
  margin: 0 12px 10px; padding: 7px 10px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
  font-size: 11px; color: var(--muted);
}
/* The binary name is the informative end of the path, so keep the tail
   visible and clip the leading directories. */
.bar-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: right; unicode-bidi: plaintext; }
.tag {
  flex-shrink: 0; padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 700; background: var(--surface-hi);
}
.tag.ok  { color: var(--ok);  background: rgba(var(--ok-rgb), .16); }
.tag.err { color: var(--err); background: rgba(var(--err-rgb), .16); min-width: 16px; text-align: center; }
.metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 0 12px; }
.metric {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
  padding: 10px 6px 8px; text-align: center; min-width: 0;
}
.metric-value {
  /* The headline number, stated at full foreground: inheriting leaves it at
     whatever the surrounding text uses, which reads washed out on dark themes
     where the foreground token is already a soft grey. */
  color: var(--vscode-foreground);
  font-size: 15px; font-weight: 800; line-height: 1.15; letter-spacing: -.02em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.metric-label {
  margin-top: 3px; font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .07em; color: var(--muted);
}
section { margin-top: 6px; }
section h2 {
  padding: 10px 13px 6px;
  font-size: 10px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--muted);
}
.actions { display: flex; flex-direction: column; gap: 4px; padding: 0 10px; }
.action {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 8px 12px; text-align: left; cursor: pointer;
  font-family: inherit; font-size: 12px; font-weight: 500;
  color: var(--vscode-foreground);
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
  transition: background .12s ease, border-color .12s ease;
}
.action:hover { background: var(--surface-hi); border-color: var(--line-hi); }
.action:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.action.primary {
  font-weight: 600; color: var(--ok);
  background: rgba(var(--ok-rgb), .10);
  border-color: rgba(var(--ok-rgb), .30);
}
.action.primary:hover { background: rgba(var(--ok-rgb), .18); }
.action.danger {
  font-weight: 600; color: var(--err);
  background: rgba(var(--err-rgb), .10);
  border-color: rgba(var(--err-rgb), .28);
}
.icon { width: 15px; height: 15px; flex-shrink: 0; opacity: .75; pointer-events: none; }
.action:hover .icon, .action.primary .icon, .action.danger .icon { opacity: 1; }
.card {
  margin: 4px 10px; padding: 11px 13px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
  transition: border-color .12s ease;
}
.card:hover { border-color: var(--line-hi); }
.card-head { display: flex; align-items: flex-start; gap: 9px; }
.dot {
  width: 7px; height: 7px; margin-top: 4px; flex-shrink: 0;
  border-radius: 50%; background: var(--ok);
}
.card-text { flex: 1; min-width: 0; }
.card-name { font-size: 12px; font-weight: 700; line-height: 1.3; word-break: break-word; }
.card-path { margin-top: 1px; font-size: 10px; color: var(--muted); word-break: break-all; }
.card-tool {
  flex-shrink: 0; padding: 3px; cursor: pointer; opacity: 0;
  color: var(--muted); background: none;
  border: 1px solid transparent; border-radius: 4px;
  transition: opacity .12s ease, color .12s ease, background .12s ease;
}
.card:hover .card-tool { opacity: .65; }
/* Reindex is not destructive, so it hovers in the accent colour. Only the
   remove button carries the red, which is what makes the red mean something. */
.card-tool:hover, .card-tool:focus-visible {
  opacity: 1; color: var(--accent);
  background: rgba(var(--accent-rgb), .10);
  border-color: rgba(var(--accent-rgb), .28);
}
.card-tool.danger:hover, .card-tool.danger:focus-visible {
  color: var(--err);
  background: rgba(var(--err-rgb), .10);
  border-color: rgba(var(--err-rgb), .28);
}
.card-tool .icon { width: 14px; height: 14px; opacity: 1; }
.card-stats {
  display: flex; align-items: center; gap: 5px;
  margin-top: 6px; font-size: 11px; color: var(--muted);
}
.card-stats em { font-style: normal; opacity: .7; }
.card-stats .sep { opacity: .35; }
.card-age { margin-top: 4px; font-size: 10px; color: var(--muted); }
/* An index behind its working tree is worth noticing, not alarming. */
.card-age .stale { color: var(--warn); cursor: help; }
.card-tools { display: flex; gap: 2px; flex-shrink: 0; }
/* The branch reads as a label rather than another number. */
.card-stats .branch {
  max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--accent);
  /* Same cue as the CLI version: dotted means there is a tooltip worth reading. */
  border-bottom: 1px dotted currentColor; cursor: help;
}
/* The version is a button but must read as part of the sub-title, not a control. */
button.ver {
  background: none; border: 0; padding: 0; font: inherit; color: inherit;
  border-bottom: 1px dotted currentColor; cursor: pointer;
}
.setting { padding: 0 12px 12px; }
.setting-key {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 600; margin-bottom: 4px;
}
.badge {
  font-size: 9px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  padding: 1px 5px; border-radius: 999px; cursor: help;
  color: var(--warn); background: rgba(var(--warn-rgb), .13);
}
.ctl {
  width: 100%; box-sizing: border-box; padding: 5px 7px; border-radius: var(--r);
  font: inherit; font-size: 11px;
  color: var(--vscode-input-foreground, var(--vscode-foreground));
  background: var(--vscode-input-background, var(--surface));
  border: 1px solid var(--vscode-input-border, var(--line));
}
.ctl:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.setting-desc { margin: 4px 0 0; font-size: 10px; color: var(--muted); line-height: 1.5; }
/* The destructive section is set apart rather than sitting in the same list. */
/* Full-width so the children keep the same 12px gutter as every other
   section; the rule only adds the separating line above it. */
.danger {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(var(--err-rgb), .35);
}
.danger h2 { color: var(--err); }
.action.danger { color: var(--err); }
.action.danger:hover { background: rgba(var(--err-rgb), .12); }
.skeleton { display: flex; flex-direction: column; gap: 7px; }
.sk { display: block; height: 9px; border-radius: 4px; background: var(--surface-hi); animation: sk 1.3s ease-in-out infinite; }
.sk-1 { width: 45%; }
.sk-2 { width: 75%; }
@keyframes sk { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }
@media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
.notice {
  margin: 8px 12px 0; padding: 8px 10px;
  border-radius: var(--r); font-size: 11px; line-height: 1.45;
  border: 1px solid var(--line); background: var(--surface);
}
.notice.warning {
  color: var(--warn);
  border-color: rgba(var(--warn-rgb), .30);
  background: rgba(var(--warn-rgb), .10);
}
/* No extra opacity on top of --muted: the token is already dimmed, and
   stacking the two made the empty state near-illegible on dark themes. */
.empty { padding: 16px 13px; font-size: 11px; color: var(--muted); text-align: center; }
`

/** No remote content, no inline scripts beyond the nonce. */
export function contentSecurityPolicy(nonce: string, cspSource: string): string {
  return [
    "default-src 'none'",
    // The panel stylesheet is inlined with the same nonce, so no stylesheet can
    // be loaded from anywhere and 'unsafe-inline' is never needed.
    `style-src 'nonce-${nonce}' ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource}`,
  ].join('; ')
}
