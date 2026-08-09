import { allowedActions, type ExtensionState } from '../state/machine'

export type WizardStepId =
  | 'choose-source'
  | 'download-binary'
  | 'verify-binary'
  | 'register-mcp'
  | 'copy-install-command'
  | 'resolve-path-conflict'
  | 'reregister-foreign-entry'
  | 'add-projects'
  | 'done'

export interface WizardStep {
  id: WizardStepId
  title: string
  detail: string
}

const STEPS: Record<WizardStepId, Omit<WizardStep, 'id'>> = {
  'choose-source': {
    title: 'Choose the binary source',
    detail: 'Download a managed copy, or point the extension at your own installation.',
  },
  'download-binary': {
    title: 'Download the binary',
    detail: 'Fetch the latest release from GitHub.',
  },
  'verify-binary': {
    title: 'Verify the download',
    detail: 'Compare the SHA-256 digest against the published checksums.',
  },
  'register-mcp': {
    title: 'Register the MCP server',
    detail: 'Run codebase-memory-mcp install, which writes the MCP entry.',
  },
  'copy-install-command': {
    title: 'Register your own installation',
    detail: 'Copy codebase-memory-mcp install and run it in a terminal.',
  },
  'resolve-path-conflict': {
    title: 'Resolve the registered path',
    detail: 'The MCP entry points at a different binary than the active one. Re-run the install command so the entry matches.',
  },
  'reregister-foreign-entry': {
    title: 'Register the MCP server on this machine',
    detail:
      'The MCP entry was written on another operating system, so the binary it names is not here. Register it again to point the entry at this machine.',
  },
  'add-projects': {
    title: 'Add repositories',
    detail: 'Pick the repositories to index. The open workspace is not added by itself.',
  },
  done: {
    title: 'Setup complete',
    detail: 'The binary is installed, registered, and at least one project is indexed.',
  },
}

/** Every step id, for tests that must cover each one without hardcoding the list. */
export const WIZARD_STEP_IDS = Object.keys(STEPS) as WizardStepId[]

/** The user-facing title for a step id. The one place step text is allowed to live. */
export function wizardStepTitle(id: WizardStepId): string {
  return STEPS[id].title
}

/**
 * Remaining steps for the current state.
 *
 * Recomputed on every call, which is what makes the wizard resumable: an abort
 * after the download simply leaves the later steps in the next run's list.
 */
export function wizardSteps(state: ExtensionState, hasProjects: boolean): WizardStep[] {
  const ids: WizardStepId[] = []
  const actions = allowedActions(state)

  if (state.kind === 'needs-setup') {
    ids.push('choose-source', 'download-binary', 'verify-binary', 'register-mcp')
  } else if (state.kind === 'binary-not-registered') {
    ids.push(actions.showInstallButton ? 'register-mcp' : 'copy-install-command')
  }

  if (state.pathConflict !== null) {
    ids.push('resolve-path-conflict')
  }

  if (state.foreignPlatformEntry !== null) {
    ids.push('reregister-foreign-entry')
  }

  if (!hasProjects) {
    ids.push('add-projects')
  }

  if (ids.length === 0) {
    ids.push('done')
  }

  return ids.map((id) => ({ id, ...STEPS[id] }))
}
