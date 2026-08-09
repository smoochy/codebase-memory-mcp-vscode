import * as assert from 'node:assert/strict'
import {
  allowedActions,
  updateOffer,
  computeState,
  entryPathPlatform,
  type RegistrationStatus,
  type StateInput,
} from '../../src/state/machine'

const MANAGED = 'C:/globalStorage/bin/codebase-memory-mcp.exe'
const EXTERNAL = 'C:/Users/x/.local/bin/codebase-memory-mcp.exe'
const present = (path: string): RegistrationStatus => ({ kind: 'present', path })
const missing: RegistrationStatus = { kind: 'missing' }
const unknown: RegistrationStatus = { kind: 'unknown' }

const input = (over: Partial<StateInput> = {}): StateInput => ({
  source: 'auto',
  managedPath: null,
  externalPath: null,
  registration: unknown,
  platform: 'win32',
  ...over,
})

describe('computeState', () => {
  it('needs setup when no binary exists at all', () => {
    const state = computeState(input())
    assert.equal(state.kind, 'needs-setup')
    assert.equal(state.activePath, null)
  })

  // Under auto a managed install wins once it exists. It can only exist
  // because the user ran Setup, and Setup is refused while an external binary
  // is active, so it is a deliberate choice. It also has to win for
  // correctness: Setup registers the managed path as the MCP command, and
  // another binary becoming active afterwards leaves that entry aimed
  // elsewhere - which is exactly the conflict this rule was changed to fix.
  it('prefers the managed binary under auto once one has been installed', () => {
    const state = computeState(
      input({ managedPath: MANAGED, externalPath: EXTERNAL, registration: present(MANAGED) }),
    )
    assert.equal(state.kind, 'ready-managed')
    assert.equal(state.activePath, MANAGED)
    assert.equal(state.effectiveSource, 'managed')
    assert.equal(state.pathConflict, null)
  })

  it('prefers an existing installation under auto when nothing is managed', () => {
    const state = computeState(input({ externalPath: EXTERNAL, registration: present(EXTERNAL) }))
    assert.equal(state.kind, 'ready-external')
    assert.equal(state.activePath, EXTERNAL)
    assert.equal(state.effectiveSource, 'external')
  })

  it('uses the managed binary under auto when no external one exists', () => {
    const state = computeState(input({ managedPath: MANAGED, registration: present(MANAGED) }))
    assert.equal(state.kind, 'ready-managed')
    assert.equal(state.activePath, MANAGED)
  })

  it('ignores an external binary when managed is forced', () => {
    const state = computeState(
      input({
        source: 'managed',
        managedPath: MANAGED,
        externalPath: EXTERNAL,
        registration: present(MANAGED),
      }),
    )
    assert.equal(state.kind, 'ready-managed')
    assert.equal(state.activePath, MANAGED)
  })

  it('falls back to managed with a notice when the chosen external binary is gone', () => {
    const state = computeState(
      input({ source: 'external', managedPath: MANAGED, registration: present(MANAGED) }),
    )
    assert.equal(state.kind, 'fallback-managed')
    assert.equal(state.activePath, MANAGED)
    assert.ok(state.notice)
  })

  it('needs setup when external is chosen and neither binary exists', () => {
    assert.equal(computeState(input({ source: 'external' })).kind, 'needs-setup')
  })

  it('needs setup when managed is chosen but was deleted', () => {
    assert.equal(
      computeState(input({ source: 'managed', externalPath: EXTERNAL })).kind,
      'needs-setup',
    )
  })

  it('reports a present binary without an MCP entry as not registered', () => {
    const state = computeState(input({ managedPath: MANAGED, registration: missing }))
    assert.equal(state.kind, 'binary-not-registered')
    assert.equal(state.activePath, MANAGED)
    assert.equal(state.effectiveSource, 'managed')
  })

  it('treats an unreadable MCP config as registered to avoid a false alarm', () => {
    const state = computeState(input({ managedPath: MANAGED, registration: unknown }))
    assert.equal(state.kind, 'ready-managed')
    assert.equal(state.pathConflict, null)
  })

  it('reports a path conflict when the entry points elsewhere', () => {
    const state = computeState(
      input({ source: 'managed', managedPath: MANAGED, registration: present(EXTERNAL) }),
    )
    assert.equal(state.kind, 'ready-managed')
    assert.deepEqual(state.pathConflict, { entryPath: EXTERNAL, activePath: MANAGED })
  })

  it('does not report a conflict when the paths differ only by separator or case', () => {
    const state = computeState(
      input({
        source: 'managed',
        managedPath: 'C:/globalStorage/bin/codebase-memory-mcp.exe',
        registration: present('c:\\globalStorage\\bin\\codebase-memory-mcp.exe'),
      }),
    )
    assert.equal(state.pathConflict, null)
  })

  // Settings Sync carries mcp.json between machines and it holds one absolute
  // path, so the second machine inherits an entry that names a binary it does
  // not have. That is a different failure from a same-platform mismatch: the
  // server is dead rather than aimed at the wrong copy.
  it('reports a POSIX entry on Windows as a foreign-platform entry', () => {
    const state = computeState(
      input({
        source: 'managed',
        managedPath: MANAGED,
        registration: present('/Users/x/.local/bin/codebase-memory-mcp'),
      }),
    )
    assert.equal(state.pathConflict, null)
    assert.deepEqual(state.foreignPlatformEntry, {
      entryPath: '/Users/x/.local/bin/codebase-memory-mcp',
      activePath: MANAGED,
    })
  })

  it('reports a Windows entry on POSIX as a foreign-platform entry', () => {
    const state = computeState(
      input({
        platform: 'darwin',
        source: 'managed',
        managedPath: '/Users/x/.local/bin/codebase-memory-mcp',
        registration: present(MANAGED),
      }),
    )
    assert.equal(state.pathConflict, null)
    assert.equal(state.foreignPlatformEntry?.entryPath, MANAGED)
  })

  it('keeps a same-platform mismatch as a plain path conflict', () => {
    const state = computeState(
      input({ source: 'managed', managedPath: MANAGED, registration: present(EXTERNAL) }),
    )
    assert.equal(state.foreignPlatformEntry, null)
    assert.deepEqual(state.pathConflict, { entryPath: EXTERNAL, activePath: MANAGED })
  })

  it('keeps an unrecognisable entry path as a plain path conflict', () => {
    const state = computeState(
      input({ source: 'managed', managedPath: MANAGED, registration: present('codebase-memory-mcp') }),
    )
    assert.equal(state.foreignPlatformEntry, null)
    assert.equal(state.pathConflict?.entryPath, 'codebase-memory-mcp')
  })
})

describe('entryPathPlatform', () => {
  it('reads a drive letter or a UNC prefix as Windows', () => {
    assert.equal(entryPathPlatform('C:\\bin\\codebase-memory-mcp.exe'), 'win32')
    assert.equal(entryPathPlatform('c:/bin/codebase-memory-mcp.exe'), 'win32')
    assert.equal(entryPathPlatform('\\\\server\\share\\codebase-memory-mcp.exe'), 'win32')
  })

  it('reads a leading slash as POSIX', () => {
    assert.equal(entryPathPlatform('/usr/local/bin/codebase-memory-mcp'), 'posix')
  })

  it('refuses to guess at anything else', () => {
    assert.equal(entryPathPlatform('codebase-memory-mcp'), null)
    assert.equal(entryPathPlatform('./bin/codebase-memory-mcp'), null)
    assert.equal(entryPathPlatform(''), null)
  })
})

describe('updateOffer', () => {
  const base = {
    installedVersion: '0.9.0',
    latestTag: 'v1.0.0',
    checkForUpdates: true,
  }

  it('offers the newer tag for a managed binary', () => {
    assert.equal(updateOffer(base), 'v1.0.0')
  })

  it('offers nothing when the installed version is already current', () => {
    assert.equal(updateOffer({ ...base, installedVersion: '1.0.0' }), null)
  })

  it('offers nothing when the installed version is newer than the release', () => {
    assert.equal(updateOffer({ ...base, installedVersion: '1.1.0' }), null)
  })


  it('respects the checkForUpdates setting', () => {
    assert.equal(updateOffer({ ...base, checkForUpdates: false }), null)
  })

  // A failed release lookup or an unreadable CLI version must leave the banner
  // hidden rather than offering an update the extension cannot substantiate.
  it('offers nothing when the release lookup failed', () => {
    assert.equal(updateOffer({ ...base, latestTag: null }), null)
  })

  it('offers nothing when the installed version could not be read', () => {
    assert.equal(updateOffer({ ...base, installedVersion: null }), null)
  })

  // The source no longer gates the offer - an external binary is told about a
  // release too - but `allowedActions` still decides who gets a button.
  it('offers the tag whatever the binary source, the button is gated elsewhere', () => {
    assert.equal(updateOffer(base), 'v1.0.0')
  })
})

describe('allowedActions', () => {
  it('permits updates and MCP writes for a managed binary', () => {
    const actions = allowedActions(
      computeState(
        input({ source: 'managed', managedPath: MANAGED, registration: present(MANAGED) }),
      ),
    )
    assert.equal(actions.showUpdateButton, true)
    assert.equal(actions.mayWriteMcpConfig, true)
  })

  it('never writes MCP config or offers updates for an external binary', () => {
    const actions = allowedActions(
      computeState(
        input({ source: 'external', externalPath: EXTERNAL, registration: present(EXTERNAL) }),
      ),
    )
    assert.equal(actions.mayWriteMcpConfig, false)
    assert.equal(actions.showInstallButton, false)
    assert.equal(actions.showUpdateButton, false)
  })

  it('offers install when a managed binary is unregistered', () => {
    const actions = allowedActions(
      computeState(input({ source: 'managed', managedPath: MANAGED, registration: missing })),
    )
    assert.equal(actions.showInstallButton, true)
    assert.equal(actions.showClipboardHint, false)
  })

  it('offers only the clipboard hint when an external binary is unregistered', () => {
    const actions = allowedActions(
      computeState(input({ source: 'external', externalPath: EXTERNAL, registration: missing })),
    )
    assert.equal(actions.showInstallButton, false)
    assert.equal(actions.showClipboardHint, true)
  })

  it('follows the resolved binary under auto, not the literal setting', () => {
    const external = allowedActions(
      computeState(input({ externalPath: EXTERNAL, registration: present(EXTERNAL) })),
    )
    assert.equal(external.mayWriteMcpConfig, false)

    const managed = allowedActions(
      computeState(input({ managedPath: MANAGED, registration: present(MANAGED) })),
    )
    assert.equal(managed.mayWriteMcpConfig, true)
  })
})
