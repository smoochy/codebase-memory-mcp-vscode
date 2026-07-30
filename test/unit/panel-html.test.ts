import * as assert from 'node:assert/strict'
import type { ProjectSummary } from '../../src/cli/client'
import { contentSecurityPolicy, escapeHtml, renderBody, type PanelModel } from '../../src/panel/html'
import { computeState, type ExtensionState } from '../../src/state/machine'

const MANAGED = 'C:/storage/bin/cmm.exe'

const model = (over: Partial<PanelModel> = {}): PanelModel => ({
  state: computeState({
    source: 'managed',
    managedPath: MANAGED,
    externalPath: null,
    registration: { kind: 'present', path: MANAGED },
  }),
  projects: [],
  version: '0.9.0',
  updateAvailable: null,
  ...over,
})

describe('escapeHtml', () => {
  it('escapes the characters that could break out of markup', () => {
    assert.equal(escapeHtml('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;')
    assert.equal(escapeHtml("a & b '"), 'a &amp; b &#39;')
  })

  it('escapes & first so entities it emits are not re-escaped', () => {
    // A raw < is the ordering probe: the < rule emits "&lt;", which contains an
    // &. If the & pass ran after it, that emitted & would itself be escaped and
    // the output would be "&amp;lt;" — rendering the entity as visible text.
    // This assertion fails if the & pass is moved anywhere but first.
    assert.equal(escapeHtml('<'), '&lt;')
    assert.equal(escapeHtml('a<b&c'), 'a&lt;b&amp;c')
    // Literal entity text in the input is escaped, not passed through.
    assert.equal(escapeHtml('&lt;'), '&amp;lt;')
  })

  it('escapes a backtick', () => {
    assert.equal(escapeHtml('`'), '&#96;')
  })

  it('does not throw when malformed CLI JSON yields a non-string', () => {
    // ProjectSummary is cast, not validated — a null/number name must degrade
    // to harmless text rather than crashing the whole panel render.
    const bad = escapeHtml as unknown as (v: unknown) => string
    assert.equal(bad(null), 'null')
    assert.equal(bad(undefined), 'undefined')
    assert.equal(bad(42), '42')
    const html = renderBody(
      model({ projects: [{ name: null, path: 42 } as unknown as ProjectSummary] }),
      'n1',
    )
    assert.match(html, /<td>null<\/td>/)
    assert.match(html, /42/)
  })
})

describe('renderBody', () => {
  it('shows the setup call to action when no binary is present', () => {
    const state = computeState({
      source: 'auto',
      managedPath: null,
      externalPath: null,
      registration: { kind: 'unknown' },
    })
    const html = renderBody(model({ state }), 'n1')
    assert.match(html, /data-command="betterCmm.runSetup"/)
  })

  it('offers install only when the managed binary is unregistered', () => {
    const unregistered = computeState({
      source: 'managed',
      managedPath: MANAGED,
      externalPath: null,
      registration: { kind: 'missing' },
    })
    assert.match(renderBody(model({ state: unregistered }), 'n1'), /betterCmm.installCli/)
    assert.doesNotMatch(renderBody(model(), 'n1'), /betterCmm.installCli/)
  })

  it('offers the clipboard hint instead of install for an external binary', () => {
    const external = computeState({
      source: 'external',
      managedPath: null,
      externalPath: '/usr/bin/cmm',
      registration: { kind: 'missing' },
    })
    const html = renderBody(model({ state: external }), 'n1')
    assert.match(html, /betterCmm.copyInstallCommand/)
    assert.doesNotMatch(html, /betterCmm.installCli/)
  })

  it('hides the update button for an external binary', () => {
    const external = computeState({
      source: 'external',
      managedPath: null,
      externalPath: '/usr/bin/cmm',
      registration: { kind: 'present', path: '/usr/bin/cmm' },
    })
    assert.doesNotMatch(renderBody(model({ state: external }), 'n1'), /betterCmm.updateBinary/)
  })

  it('announces an available update', () => {
    assert.match(renderBody(model({ updateAvailable: '0.9.1' }), 'n1'), /0\.9\.1/)
  })

  it('renders the project rows', () => {
    const html = renderBody(
      model({ projects: [{ name: 'app', path: 'D:/Repos/app', files: 12 }] }),
      'n1',
    )
    assert.match(html, /D:\/Repos\/app/)
    assert.match(html, />12</)
  })

  it('escapes a project name so markup in it cannot execute', () => {
    const html = renderBody(
      model({ projects: [{ name: '<script>alert(1)</script>', path: '/x' }] }),
      'n1',
    )
    assert.doesNotMatch(html, /<script>alert/)
    assert.match(html, /&lt;script&gt;/)
  })

  it('shows an empty state rather than an empty table', () => {
    assert.match(renderBody(model(), 'n1'), /no projects/i)
  })

  it('shows the fallback notice when one is present', () => {
    const fallback = computeState({
      source: 'external',
      managedPath: MANAGED,
      externalPath: null,
      registration: { kind: 'present', path: MANAGED },
    })
    assert.match(renderBody(model({ state: fallback }), 'n1'), /falling back/i)
  })

  it('reports a path conflict without offering to repair it', () => {
    const conflict = computeState({
      source: 'managed',
      managedPath: MANAGED,
      externalPath: null,
      registration: { kind: 'present', path: '/other/cmm' },
    })
    const html = renderBody(model({ state: conflict }), 'n1')
    assert.match(html, /\/other\/cmm/)
    assert.doesNotMatch(html, /betterCmm.repair/)
  })

  it('puts the nonce on every script tag', () => {
    const html = renderBody(model(), 'n1')
    for (const tag of html.match(/<script[^>]*>/g) ?? []) {
      assert.match(tag, /nonce="n1"/)
    }
  })

  // --- Security case (a): every untrusted value reaching the markup is escaped ---

  const XSS_PAYLOAD = '"><script>alert(1)</script>'

  it('escapes a hostile activePath (filesystem path from disk/CLI)', () => {
    const state = computeState({
      source: 'managed',
      managedPath: XSS_PAYLOAD,
      externalPath: null,
      registration: { kind: 'present', path: XSS_PAYLOAD },
    })
    const html = renderBody(model({ state }), 'n1')
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  it('escapes a hostile state.notice (fallback message can embed a path)', () => {
    // notice is only ever set by computeState's own fallback string today,
    // but it is typed as an arbitrary string, so treat it as untrusted and
    // drive it through the public state shape rather than a private field.
    const state: ExtensionState = {
      kind: 'ready-managed',
      activePath: MANAGED,
      effectiveSource: 'managed',
      notice: XSS_PAYLOAD,
      pathConflict: null,
    }
    const html = renderBody(model({ state }), 'n1')
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  it('escapes a hostile pathConflict.entryPath (from the MCP config file on disk)', () => {
    const state: ExtensionState = {
      kind: 'ready-managed',
      activePath: MANAGED,
      effectiveSource: 'managed',
      notice: null,
      pathConflict: { entryPath: XSS_PAYLOAD, activePath: MANAGED },
    }
    const html = renderBody(model({ state }), 'n1')
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  it('escapes a hostile pathConflict.activePath', () => {
    const state: ExtensionState = {
      kind: 'ready-managed',
      activePath: MANAGED,
      effectiveSource: 'managed',
      notice: null,
      pathConflict: { entryPath: MANAGED, activePath: XSS_PAYLOAD },
    }
    const html = renderBody(model({ state }), 'n1')
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  it('escapes a hostile project path', () => {
    const html = renderBody(
      model({ projects: [{ name: 'app', path: XSS_PAYLOAD }] }),
      'n1',
    )
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  // --- Security case (b): attribute-context escaping for data-project ---

  it('cannot break out of the data-project attribute with quotes/backtick', () => {
    const hostileName = '" onmouseover="alert(1)'
    const html = renderBody(model({ projects: [{ name: hostileName, path: '/x' }] }), 'n1')

    // The literal payload must not appear unescaped (a real, unescaped
    // attribute-boundary quote followed by a live onmouseover=" attribute).
    assert.doesNotMatch(html, /data-project="" onmouseover="alert\(1\)"/)

    // Extract the remove button's opening tag and confirm it parses as
    // exactly one element with exactly one data-project attribute value
    // that round-trips to the original hostile string once unescaped.
    const buttonMatch = /<button class="remove"[^>]*>/.exec(html)
    assert.ok(buttonMatch, 'expected a remove button in the output')
    const tag = buttonMatch[0]

    // Count raw (unescaped) double quotes: must be exactly the delimiters
    // for class="remove" (2) and data-command="..." (2) and data-project="..." (2) = 6.
    const rawQuoteCount = (tag.match(/"/g) ?? []).length
    assert.equal(rawQuoteCount, 6, `expected exactly 6 raw quotes in tag, got: ${tag}`)

    // No live onmouseover attribute was injected — only inert escaped text
    // inside the data-project value is permitted, never a real "onmouseover=".
    assert.doesNotMatch(tag, /\bonmouseover\s*="/)

    const dataProjectMatch = /data-project="([^"]*)"/.exec(tag)
    assert.ok(dataProjectMatch, 'expected a single well-formed data-project attribute')
    assert.equal(dataProjectMatch[1], '&quot; onmouseover=&quot;alert(1)')
  })

  it('cannot break out of the data-project attribute with a single quote or backtick', () => {
    const hostileName = `'`+'`'+`onmouseover=alert(1)`
    const html = renderBody(model({ projects: [{ name: hostileName, path: '/x' }] }), 'n1')
    const buttonMatch = /<button class="remove"[^>]*>/.exec(html)
    assert.ok(buttonMatch)
    const tag = buttonMatch[0]
    // Exactly one data-project attribute, still a single well-formed tag —
    // the raw quote/backtick did not add or split any attribute.
    assert.equal((tag.match(/data-project="/g) ?? []).length, 1)
    assert.equal((tag.match(/`/g) ?? []).length, 0, 'raw backtick must not survive escaping')
    assert.equal((tag.match(/'/g) ?? []).length, 0, "raw single quote must not survive escaping")
  })

  // --- Security case (d): every <script tag, in every state variant, carries the nonce ---

  it('carries the nonce on every <script> occurrence for every state variant', () => {
    const nonce = 'the-nonce-123'
    const variants: ExtensionState[] = [
      computeState({
        source: 'auto',
        managedPath: null,
        externalPath: null,
        registration: { kind: 'unknown' },
      }), // needs-setup
      computeState({
        source: 'managed',
        managedPath: MANAGED,
        externalPath: null,
        registration: { kind: 'present', path: MANAGED },
      }), // ready-managed
      computeState({
        source: 'external',
        managedPath: null,
        externalPath: '/usr/bin/cmm',
        registration: { kind: 'present', path: '/usr/bin/cmm' },
      }), // ready-external
      computeState({
        source: 'managed',
        managedPath: MANAGED,
        externalPath: null,
        registration: { kind: 'missing' },
      }), // binary-not-registered
      computeState({
        source: 'external',
        managedPath: MANAGED,
        externalPath: null,
        registration: { kind: 'present', path: MANAGED },
      }), // fallback-managed
    ]

    const kinds = variants.map((s) => s.kind)
    assert.deepEqual(
      new Set(kinds),
      new Set(['needs-setup', 'ready-managed', 'ready-external', 'binary-not-registered', 'fallback-managed']),
      'test must cover every StateKind variant',
    )

    for (const state of variants) {
      const html = renderBody(model({ state }), nonce)
      const occurrences = html.match(/<script\b[^>]*>/g) ?? []
      assert.ok(occurrences.length > 0, `expected at least one <script> tag for state kind ${state.kind}`)
      for (const tag of occurrences) {
        assert.match(
          tag,
          new RegExp(`nonce="${nonce}"`),
          `<script> tag missing nonce for state kind ${state.kind}: ${tag}`,
        )
      }
    }
  })

  // --- Security case (e): a hostile nonce cannot break out of its attribute ---

  it('escapes a hostile nonce so it cannot break out of the attribute or inject a second attribute', () => {
    const hostileNonce = `abc" data-injected="1`
    const html = renderBody(model(), hostileNonce)
    // A live (unescaped) data-injected="1" attribute must never appear.
    assert.doesNotMatch(html, /data-injected="1"/)
    const scriptMatch = /<script[^>]*>/.exec(html)
    assert.ok(scriptMatch)
    const tag = scriptMatch[0]
    // Exactly one attribute on the tag: nonce="...". Its value round-trips
    // (escaped) to the hostile input, proving no second attribute was added.
    assert.equal((tag.match(/="/g) ?? []).length, 1, `expected exactly one attribute in: ${tag}`)
    const nonceMatch = /nonce="([^"]*)"/.exec(tag)
    assert.ok(nonceMatch)
    assert.equal(nonceMatch[1], 'abc&quot; data-injected=&quot;1')
  })
})

describe('contentSecurityPolicy', () => {
  it('allows only nonce scripts and no remote content', () => {
    const csp = contentSecurityPolicy('n1', 'vscode-resource://x')
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /script-src 'nonce-n1'/)
    assert.doesNotMatch(csp, /unsafe-inline/)
  })

  it('never permits unsafe-eval in any directive', () => {
    const csp = contentSecurityPolicy('n1', 'vscode-resource://x')
    assert.doesNotMatch(csp, /unsafe-eval/)
  })
})
