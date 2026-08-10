import * as assert from 'node:assert/strict'
import Module from 'node:module'
import type { PanelModel } from '../../src/panel/html'

/**
 * `vscode` only exists inside the extension host, and `PanelProvider` imports
 * it for its types and for `Uri`. The badge logic needs neither at runtime, so
 * the module is stubbed rather than the test moved into the integration suite,
 * where a badge assertion would depend on whatever the real CLI reports.
 */
const load = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load
;(Module as unknown as { _load: unknown })._load = function (
  request: string,
  ...rest: unknown[]
): unknown {
  if (request === 'vscode') {
    return {}
  }
  return load.call(this, request, ...rest)
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PanelProvider } = require('../../src/panel/provider') as typeof import('../../src/panel/provider')

/** Records every write, so a badge that is set and cleared is still visible. */
class FakeView {
  writes: (unknown | undefined)[] = []
  webview = {
    options: {},
    html: '',
    cspSource: 'vscode-resource://x',
    onDidReceiveMessage: () => undefined,
    postMessage: () => Promise.resolve(true),
  }
  visible = true
  set badge(value: unknown | undefined) {
    this.writes.push(value)
  }
}

function modelWith(updateAvailable: string | null): PanelModel {
  return {
    state: {
      kind: 'ready-managed',
      activePath: null,
      effectiveSource: 'managed',
      notice: null,
      pathConflict: null,
      foreignPlatformEntry: null,
    },
    projects: [],
    version: '1.0.0',
    updateAvailable,
    extensionVersion: '0.9.7',
    loading: false,
    view: 'main',
    cliSettings: [],
  }
}

function provider(): { p: InstanceType<typeof PanelProvider>; view: FakeView } {
  const p = new PanelProvider({} as never, () => undefined, '0.9.7')
  const view = new FakeView()
  p.resolveWebviewView(view as never)
  return { p, view }
}

/** Every badge the provider reported, in order. */
function reported(p: InstanceType<typeof PanelProvider>): (unknown | undefined)[] {
  const seen: (unknown | undefined)[] = []
  p.onBadgeChange((badge) => seen.push(badge))
  return seen
}

describe('activity bar badge', () => {
  it('reports no badge at all on a first activation with nothing pending', () => {
    const { p } = provider()
    const seen = reported(p)
    p.update(modelWith(null))
    assert.deepEqual(
      seen.filter((w) => w !== undefined),
      [],
      'a fresh install must not claim an update',
    )
  })

  it('badges an available update', () => {
    const { p } = provider()
    const seen = reported(p)
    p.update(modelWith('1.1.0'))
    assert.equal((seen[seen.length - 1] as { value: number } | undefined)?.value, 1)
  })

  // The badge exists so an update is visible without opening the panel, so it
  // must be reported by a refresh that happened before any view was resolved.
  it('badges before the panel has ever been opened', () => {
    const p = new PanelProvider({} as never, () => undefined, '0.9.7')
    const seen = reported(p)
    p.update(modelWith('1.1.0'))
    assert.equal((seen[seen.length - 1] as { value: number } | undefined)?.value, 1)
  })

  it('clears the badge once the update is gone, and reports each change once', () => {
    const { p } = provider()
    const seen = reported(p)
    p.update(modelWith('1.1.0'))
    p.update(modelWith('1.1.0'))
    p.update(modelWith(null))
    assert.equal(seen.length, 3, 'an unchanged badge must not be reported again')
    assert.equal(seen[seen.length - 1], undefined)
  })
})
