export type BinarySource = 'auto' | 'managed' | 'external'

export type StateKind =
  | 'ready-managed'
  | 'ready-external'
  | 'binary-not-registered'
  | 'fallback-managed'
  | 'needs-setup'

/** What we could learn about the VS Code MCP entry. */
export type RegistrationStatus =
  | { kind: 'present'; path: string }
  | { kind: 'missing' }
  | { kind: 'unknown' }

export interface StateInput {
  source: BinarySource
  managedPath: string | null
  externalPath: string | null
  registration: RegistrationStatus
}

export interface ExtensionState {
  kind: StateKind
  activePath: string | null
  effectiveSource: 'managed' | 'external' | null
  /** User-visible note, for example the fallback from external to managed. */
  notice: string | null
  pathConflict: { entryPath: string; activePath: string } | null
}

export interface AllowedActions {
  showInstallButton: boolean
  showUpdateButton: boolean
  mayWriteMcpConfig: boolean
  showClipboardHint: boolean
}

/** Compare paths tolerating separator and case differences on Windows. */
function samePath(a: string, b: string): boolean {
  const normalize = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  return normalize(a) === normalize(b)
}

/**
 * Derive the current state. Pure: every input is passed in, nothing is probed.
 *
 * Under `auto` an existing external binary wins. The user's own installation
 * takes precedence, the inverse of the original extension's behaviour.
 */
export function computeState(input: StateInput): ExtensionState {
  const { source, managedPath, externalPath, registration } = input

  let activePath: string | null = null
  let effectiveSource: 'managed' | 'external' | null = null
  let kind: StateKind
  let notice: string | null = null

  if (source === 'managed') {
    activePath = managedPath
    effectiveSource = managedPath === null ? null : 'managed'
    kind = managedPath === null ? 'needs-setup' : 'ready-managed'
  } else if (source === 'external') {
    if (externalPath !== null) {
      activePath = externalPath
      effectiveSource = 'external'
      kind = 'ready-external'
    } else if (managedPath !== null) {
      activePath = managedPath
      effectiveSource = 'managed'
      kind = 'fallback-managed'
      notice = 'The external binary is gone. Falling back to the managed one until it returns.'
    } else {
      kind = 'needs-setup'
    }
  } else if (externalPath !== null) {
    activePath = externalPath
    effectiveSource = 'external'
    kind = 'ready-external'
  } else if (managedPath !== null) {
    activePath = managedPath
    effectiveSource = 'managed'
    kind = 'ready-managed'
  } else {
    kind = 'needs-setup'
  }

  if (activePath === null) {
    return {
      kind: 'needs-setup',
      activePath: null,
      effectiveSource: null,
      notice,
      pathConflict: null,
    }
  }

  // A binary without an MCP entry never starts, because VS Code owns the server.
  if (registration.kind === 'missing') {
    return { kind: 'binary-not-registered', activePath, effectiveSource, notice, pathConflict: null }
  }

  const pathConflict =
    registration.kind === 'present' && !samePath(registration.path, activePath)
      ? { entryPath: registration.path, activePath }
      : null

  return { kind, activePath, effectiveSource, notice, pathConflict }
}

/**
 * What the UI may offer. We never write into an installation we do not own,
 * so an external binary gets neither an install nor an update button.
 */
export function allowedActions(state: ExtensionState): AllowedActions {
  const managed = state.effectiveSource === 'managed'
  const unregistered = state.kind === 'binary-not-registered'

  return {
    showInstallButton: managed && unregistered,
    showUpdateButton: managed && !unregistered,
    mayWriteMcpConfig: managed,
    showClipboardHint: !managed && unregistered,
  }
}
