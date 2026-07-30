import type { ProjectSummary } from '../cli/client'
import { allowedActions, type ExtensionState } from '../state/machine'

export interface PanelModel {
  state: ExtensionState
  projects: ProjectSummary[]
  version: string | null
  /** Version string when a newer release exists, otherwise null. */
  updateAvailable: string | null
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

function button(command: string, label: string): string {
  return `<button class="action" data-command="${escapeHtml(command)}">${escapeHtml(label)}</button>`
}

function notice(kind: 'info' | 'warning', text: string): string {
  return `<p class="notice ${kind}">${escapeHtml(text)}</p>`
}

function projectRows(projects: ProjectSummary[]): string {
  if (projects.length === 0) {
    return '<p class="empty">No projects indexed yet.</p>'
  }

  const rows = projects
    .map((project) => {
      const files = project.files === undefined ? '' : String(project.files)
      return (
        '<tr>' +
        `<td>${escapeHtml(project.name)}</td>` +
        `<td class="path">${escapeHtml(project.path)}</td>` +
        `<td class="count">${escapeHtml(files)}</td>` +
        '<td>' +
        `<button class="remove" data-command="betterCmm.removeProject" data-project="${escapeHtml(project.name)}">Remove</button>` +
        '</td>' +
        '</tr>'
      )
    })
    .join('')

  return `<table class="projects"><tbody>${rows}</tbody></table>`
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
  if (!(target instanceof HTMLElement)) return
  const command = target.dataset.command
  if (command === undefined) return
  vscode.postMessage({ command, project: target.dataset.project })
})
</script>`
}

/** Header, notices, actions, project list. Static markup, no framework. */
export function renderBody(model: PanelModel, nonce: string): string {
  const { state } = model
  const actions = allowedActions(state)
  const parts: string[] = []

  if (state.kind === 'needs-setup') {
    parts.push(notice('warning', 'The codebase-memory-mcp binary was not found.'))
    parts.push(button('betterCmm.runSetup', 'Run setup'))
    // The setup button needs the same click handler as every other button.
    return `<main>${parts.join('')}</main>` + clickHandlerScript(nonce)
  }

  parts.push(
    `<p class="binary">Binary: <code>${escapeHtml(state.activePath ?? '')}</code>` +
      (model.version === null ? '' : ` <span class="version">${escapeHtml(model.version)}</span>`) +
      '</p>',
  )

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

  if (actions.showInstallButton) {
    parts.push(button('betterCmm.installCli', 'Register MCP server'))
  }
  if (actions.showClipboardHint) {
    parts.push(
      notice('info', 'Run codebase-memory-mcp install in a terminal to register the server.'),
    )
    parts.push(button('betterCmm.copyInstallCommand', 'Copy install command'))
  }
  if (actions.showUpdateButton && model.updateAvailable !== null) {
    parts.push(notice('info', `Version ${model.updateAvailable} is available.`))
    parts.push(button('betterCmm.updateBinary', `Update to ${model.updateAvailable}`))
  }

  parts.push(button('betterCmm.addProject', 'Add repositories'))
  parts.push(button('betterCmm.refresh', 'Refresh'))
  parts.push(projectRows(model.projects))

  return `<main>${parts.join('')}</main>` + clickHandlerScript(nonce)
}

/** No remote content, no inline scripts beyond the nonce. */
export function contentSecurityPolicy(nonce: string, cspSource: string): string {
  return [
    "default-src 'none'",
    `style-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource}`,
  ].join('; ')
}
