import * as assert from 'node:assert/strict'
import {
  mayModifyBinary,
  updateOffer,
  computeState,
  type StateInput,
} from '../../src/state/machine'

const MANAGED = 'C:/globalStorage/bin/codebase-memory-mcp.exe'
const EXTERNAL = 'C:/Users/x/.local/bin/codebase-memory-mcp.exe'

const input = (over: Partial<StateInput> = {}): StateInput => ({
  source: 'auto',
  managedPath: null,
  externalPath: null,
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
  // is active, so it is a deliberate choice.
  it('prefers the managed binary under auto once one has been installed', () => {
    const state = computeState(input({ managedPath: MANAGED, externalPath: EXTERNAL }))
    assert.equal(state.kind, 'ready-managed')
    assert.equal(state.activePath, MANAGED)
    assert.equal(state.effectiveSource, 'managed')
  })

  it('prefers an existing installation under auto when nothing is managed', () => {
    const state = computeState(input({ externalPath: EXTERNAL }))
    assert.equal(state.kind, 'ready-external')
    assert.equal(state.activePath, EXTERNAL)
    assert.equal(state.effectiveSource, 'external')
  })

  it('uses the managed binary under auto when no external one exists', () => {
    const state = computeState(input({ managedPath: MANAGED }))
    assert.equal(state.kind, 'ready-managed')
    assert.equal(state.activePath, MANAGED)
  })

  it('ignores an external binary when managed is forced', () => {
    const state = computeState(
      input({ source: 'managed', managedPath: MANAGED, externalPath: EXTERNAL }),
    )
    assert.equal(state.kind, 'ready-managed')
    assert.equal(state.activePath, MANAGED)
  })

  it('falls back to managed with a notice when the chosen external binary is gone', () => {
    const state = computeState(input({ source: 'external', managedPath: MANAGED }))
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

  // The server is provided in memory for whichever binary is active, so there
  // is no second question of whether that binary is also written down anywhere.
  it('reports a resolved binary as ready without consulting any config file', () => {
    const state = computeState(input({ managedPath: MANAGED }))
    assert.equal(state.kind, 'ready-managed')
    assert.equal(state.activePath, MANAGED)
    assert.equal(state.effectiveSource, 'managed')
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
  // release too - but `mayModifyBinary` still decides who gets a button.
  it('offers the tag whatever the binary source, the button is gated elsewhere', () => {
    assert.equal(updateOffer(base), 'v1.0.0')
  })
})

describe('mayModifyBinary', () => {
  it('permits updates for a managed binary', () => {
    assert.equal(
      mayModifyBinary(computeState(input({ source: 'managed', managedPath: MANAGED }))),
      true,
    )
  })

  it('never offers updates for an external binary', () => {
    assert.equal(
      mayModifyBinary(computeState(input({ source: 'external', externalPath: EXTERNAL }))),
      false,
    )
  })

  it('follows the resolved binary under auto, not the literal setting', () => {
    assert.equal(mayModifyBinary(computeState(input({ externalPath: EXTERNAL }))), false)
    assert.equal(mayModifyBinary(computeState(input({ managedPath: MANAGED }))), true)
  })
})
