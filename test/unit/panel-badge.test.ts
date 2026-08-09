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

describe('activity bar badge', () => {
  it('writes no badge at all on a first activation with nothing pending', () => {
    const { p, view } = provider()
    p.update(modelWith(null))
    assert.deepEqual(
      view.writes.filter((w) => w !== undefined),
      [],
      'a fresh install must not claim an update',
    )
  })

  it('badges an available update', () => {
    const { p, view } = provider()
    p.update(modelWith('1.1.0'))
    const last = view.writes[view.writes.length - 1] as { value: number } | undefined
    assert.equal(last?.value, 1)
  })

  it('primes the clear only once a badge has actually been shown', () => {
    const { p, view } = provider()
    p.update(modelWith('1.1.0'))
    // A second view object, as VS Code hands over after the view was hidden:
    // its badge cache is empty while the icon still shows the count, so the
    // clear needs something to differ from.
    const second = new FakeView()
    p.resolveWebviewView(second as never)
    p.update(modelWith(null))
    assert.ok(
      second.writes.some((w) => w !== undefined),
      'the stale count needs a priming write before it can be cleared',
    )
    assert.equal(second.writes[second.writes.length - 1], undefined)
  })
})
