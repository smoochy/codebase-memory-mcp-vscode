import { compareVersions } from '../binary/assets'

export type BinarySource = 'auto' | 'managed' | 'external'

export type StateKind = 'ready-managed' | 'ready-external' | 'fallback-managed' | 'needs-setup'

export interface StateInput {
  source: BinarySource
  managedPath: string | null
  externalPath: string | null
}

export interface ExtensionState {
  kind: StateKind
  activePath: string | null
  effectiveSource: 'managed' | 'external' | null
  /** User-visible note, for example the fallback from external to managed. */
  notice: string | null
}

/** Compare paths tolerating separator and case differences on Windows. */
export function samePath(a: string, b: string): boolean {
  const normalize = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  return normalize(a) === normalize(b)
}

/**
 * Derive the current state. Pure: every input is passed in, nothing is probed.
 *
 * Under `auto` an installation this extension made wins, and any other
 * installation wins when there is none. The caller decides what counts as
 * managed - it is a record of having installed it, not a location, because the
 * CLI's own installer writes to the same directory.
 */
export function computeState(input: StateInput): ExtensionState {
  const { source, managedPath, externalPath } = input

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
  } else if (managedPath !== null) {
    // Under `auto` a managed install wins once it exists. It can only exist
    // because the user ran Setup, and Setup is refused while an external
    // binary is active, so its presence is a deliberate choice rather than a
    // leftover. It also has to win for correctness: Setup registers the
    // managed path as the MCP command, and letting some other binary become
    // active afterwards leaves the entry aimed at a different file. A
    // pre-existing installation is still preferred when no managed one is
    // there, which is the point of `auto`.
    activePath = managedPath
    effectiveSource = 'managed'
    kind = 'ready-managed'
  } else if (externalPath !== null) {
    activePath = externalPath
    effectiveSource = 'external'
    kind = 'ready-external'
  } else {
    kind = 'needs-setup'
  }

  if (activePath === null) {
    return { kind: 'needs-setup', activePath: null, effectiveSource: null, notice }
  }

  return { kind, activePath, effectiveSource, notice }
}

/**
 * Whether a newer release should be offered, and which one.
 *
 * Kept here rather than inline in the refresh loop because this is the rule
 * that decides whether the panel says anything about a newer release at all:
 * only when the user left the check enabled, and only when both versions are
 * actually known. Who may act on it is a separate question, answered by
 * `mayModifyBinary` - an external binary is told, never updated.
 */
export function updateOffer(input: {
  installedVersion: string | null
  latestTag: string | null
  checkForUpdates: boolean
}): string | null {
  const { installedVersion, latestTag } = input
  if (!input.checkForUpdates) {
    return null
  }
  if (installedVersion === null || latestTag === null) {
    return null
  }
  return compareVersions(latestTag, installedVersion) > 0 ? latestTag : null
}

/**
 * Whether the extension may write into the active installation.
 *
 * Registering the MCP server is no longer part of this question: the server is
 * provided in memory for whichever binary is active, which writes nothing. What
 * is left is the update path, and we never overwrite an installation we do not
 * own.
 */
export function mayModifyBinary(state: ExtensionState): boolean {
  return state.effectiveSource === 'managed'
}
