import type { ProjectSummary } from '../cli/client'
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

/** Thousands separators, and an em dash for "nothing to report yet". */
export function formatCount(value: number | undefined): string {
  return value === undefined || value <= 0 ? '—' : value.toLocaleString('en-US')
}

/**
 * Index size for the metric card. Binary units, one decimal above a kilobyte,
 * because a graph store crosses from KB to GB and a raw byte count is unreadable
 * at either end.
 */
export function formatBytes(value: number | undefined): string {
  if (value === undefined || value <= 0) {
    return '—'
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
  trash: '<path d="M2.8 4.4h10.4M6.2 4.4V3.2a.9.9 0 0 1 .9-.9h1.8a.9.9 0 0 1 .9.9v1.2M4.3 4.4v8a1.2 1.2 0 0 0 1.2 1.2h5a1.2 1.2 0 0 0 1.2-1.2v-8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
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
    { value: formatBytes(total(projects, 'size_bytes')), label: 'Index size' },
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
 * The extension does not own the server lifecycle — the CLI's own `install`
 * subcommand registers it and VS Code starts it — so there is no running or
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
    // The extension's own version, distinct from the binary version shown in
    // the bar below — without it there is no way to tell which build is
    // installed.
    `<span class="brand-sub">Knowledge Graph Engine${
      model.extensionVersion === null || model.extensionVersion === undefined
        ? ''
        : ` · v${escapeHtml(model.extensionVersion)}`
    }</span>` +
    '</span>' +
    '</div>' +
    statusChip(model.state) +
    '</header>'
  )
}

function binaryBar(model: PanelModel): string {
  const { state } = model
  if (state.kind === 'needs-setup') {
    return '<div class="bar"><span class="tag err">!</span>No binary found — run setup to get started</div>'
  }
  const tag =
    model.version === null
      ? '<span class="tag">?</span>'
      : `<span class="tag ok">v${escapeHtml(model.version)}</span>`
  return (
    `<div class="bar">${tag}<span class="bar-text" title="${escapeHtml(state.activePath ?? '')}">` +
    `${escapeHtml(state.activePath ?? '')}</span></div>`
  )
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
        `<div class="card-name">${name}</div>` +
        `<div class="card-path">${escapeHtml(project.root_path)}</div>` +
        '</div>' +
        `<button class="remove" title="Remove from index" aria-label="Remove ${name} from the index" ` +
        `data-command="betterCmm.removeProject" data-project="${name}">${icon('trash')}</button>` +
        '</div>' +
        '<div class="card-stats">' +
        `<span>${escapeHtml(formatCount(project.nodes))} <em>nodes</em></span>` +
        '<span class="sep">·</span>' +
        `<span>${escapeHtml(formatCount(project.edges))} <em>edges</em></span>` +
        '</div>' +
        '</div>'
      )
    })
    .join('')
}

/**
 * The only script the panel ships. Built here so no caller can emit a script
 * tag without the nonce — every `renderBody` return path goes through this.
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
</script>`
}

/** Header, notices, actions, project list. Static markup, no framework. */
export function renderBody(model: PanelModel, nonce: string): string {
  const { state } = model
  const actions = allowedActions(state)
  const loading = model.loading === true
  const parts: string[] = [header(model), binaryBar(model)]

  if (state.kind === 'needs-setup') {
    parts.push(
      section(
        'Actions',
        `<div class="actions">${button('betterCmm.runSetup', 'Install binary', 'download', 'primary')}</div>`,
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

  const buttons: string[] = []
  if (actions.showInstallButton) {
    buttons.push(button('betterCmm.installCli', 'Register MCP server', 'link', 'primary'))
  }
  if (actions.showClipboardHint) {
    parts.push(
      notice('info', 'Run codebase-memory-mcp install in a terminal to register the server.'),
    )
    buttons.push(button('betterCmm.copyInstallCommand', 'Copy install command', 'copy'))
  }
  if (actions.showUpdateButton && model.updateAvailable !== null) {
    buttons.push(
      button('betterCmm.updateBinary', `Update to ${model.updateAvailable}`, 'arrowUp', 'primary'),
    )
  }
  buttons.push(button('betterCmm.addProject', 'Add repositories', 'plus'))
  buttons.push(button('betterCmm.refresh', 'Refresh', 'refresh'))
  buttons.push(button('betterCmm.showLogs', 'View logs', 'logs'))

  parts.push(section('Actions', `<div class="actions">${buttons.join('')}</div>`))
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
 * reliable signal for theme polarity inside a webview — prefers-color-scheme
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
.remove {
  flex-shrink: 0; padding: 3px; cursor: pointer; opacity: 0;
  color: var(--muted); background: none;
  border: 1px solid transparent; border-radius: 4px;
  transition: opacity .12s ease, color .12s ease, background .12s ease;
}
.card:hover .remove { opacity: .65; }
.remove:hover, .remove:focus-visible {
  opacity: 1; color: var(--err);
  background: rgba(var(--err-rgb), .10);
  border-color: rgba(var(--err-rgb), .28);
}
.remove .icon { width: 14px; height: 14px; opacity: 1; }
.card-stats {
  display: flex; align-items: center; gap: 5px;
  margin-top: 6px; font-size: 11px; color: var(--muted);
}
.card-stats em { font-style: normal; opacity: .7; }
.card-stats .sep { opacity: .35; }
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
