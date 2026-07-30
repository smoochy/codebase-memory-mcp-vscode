import { allowedActions, type ExtensionState } from '../state/machine'

export type WizardStepId =
  | 'choose-source'
  | 'download-binary'
  | 'verify-binary'
  | 'register-mcp'
  | 'copy-install-command'
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
  'add-projects': {
    title: 'Add repositories',
    detail: 'Pick the repositories to index. The open workspace is not added by itself.',
  },
  done: {
    title: 'Setup complete',
    detail: 'The binary is installed, registered, and at least one project is indexed.',
  },
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

  if (!hasProjects) {
    ids.push('add-projects')
  }

  if (ids.length === 0) {
    ids.push('done')
  }

  return ids.map((id) => ({ id, ...STEPS[id] }))
}
