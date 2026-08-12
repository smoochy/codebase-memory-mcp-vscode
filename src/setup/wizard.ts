import { type ExtensionState } from '../state/machine'

export type WizardStepId =
  | 'choose-source'
  | 'download-binary'
  | 'verify-binary'
  | 'register-mcp'
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
    title: 'Wire up the other agents',
    detail:
      'Run codebase-memory-mcp install, which registers the server with the other agents it supports. VS Code is served by the extension itself.',
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

  if (state.kind === 'needs-setup') {
    ids.push('choose-source', 'download-binary', 'verify-binary', 'register-mcp')
  }

  if (!hasProjects) {
    ids.push('add-projects')
  }

  if (ids.length === 0) {
    ids.push('done')
  }

  return ids.map((id) => ({ id, ...STEPS[id] }))
}
