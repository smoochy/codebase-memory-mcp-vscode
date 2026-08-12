import * as assert from 'node:assert/strict'
import type { ProjectSummary } from '../../src/cli/client'
import {
  contentSecurityPolicy,
  escapeHtml,
  formatBytes,
  formatCount,
  relativeTime,
  absoluteTimeLabel,
  renderBody,
  type PanelModel,
} from '../../src/panel/html'
import { computeState, type ExtensionState } from '../../src/state/machine'

const MANAGED = 'C:/storage/bin/cmm.exe'

const model = (over: Partial<PanelModel> = {}): PanelModel => ({
  state: computeState({
    source: 'managed',
    managedPath: MANAGED,
    externalPath: null,
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
    // the output would be "&amp;lt;" - rendering the entity as visible text.
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
    // ProjectSummary is cast, not validated - a null/number name must degrade
    // to harmless text rather than crashing the whole panel render.
    const bad = escapeHtml as unknown as (v: unknown) => string
    assert.equal(bad(null), 'null')
    assert.equal(bad(undefined), 'undefined')
    assert.equal(bad(42), '42')
    const html = renderBody(
      model({ projects: [{ name: null, root_path: 42 } as unknown as ProjectSummary] }),
      'n1',
    )
    assert.match(html, /null/)
    assert.match(html, /42/)
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    assert.equal(formatCount(19768), '19,768')
  })

  it('shows a dash rather than a bare zero for nothing indexed', () => {
    assert.equal(formatCount(0), '-')
    assert.equal(formatCount(undefined), '-')
  })
})

describe('formatBytes', () => {
  it('scales to binary units', () => {
    assert.equal(formatBytes(512), '512 B')
    assert.equal(formatBytes(1024), '1.0 KB')
    assert.equal(formatBytes(41156608), '39.3 MB')
  })

  it('shows a dash for an absent or empty index', () => {
    assert.equal(formatBytes(0), '-')
    assert.equal(formatBytes(undefined), '-')
  })

  it('stops at the largest unit rather than running off the end of the table', () => {
    assert.match(formatBytes(5 * 1024 ** 5), /TB$/)
  })
})

describe('relativeTime', () => {
  const at = (minutes: number): number => Date.UTC(2026, 7, 1, 12, 0) - minutes * 60_000
  const now = Date.UTC(2026, 7, 1, 12, 0)

  it('counts minutes below an hour', () => {
    assert.equal(relativeTime(at(5), now), '5m ago')
    assert.equal(relativeTime(at(27), now), '27m ago')
  })

  // Hours all the way up rather than switching to days: the question is how
  // stale the index is, and hours compare directly at a glance.
  it('counts hours above one, without ever switching to days', () => {
    assert.equal(relativeTime(at(60), now), '1h ago')
    assert.equal(relativeTime(at(73 * 60), now), '73h ago')
    assert.equal(relativeTime(at(183 * 60), now), '183h ago')
  })

  // Hours carry their minutes: "5h 24m ago" is far more precise about staleness
  // than "5h ago", and the extra token costs nothing at this size.
  it('includes the minutes past the hour', () => {
    assert.equal(relativeTime(at(5 * 60 + 24), now), '5h 24m ago')
    assert.equal(relativeTime(at(61), now), '1h 1m ago')
  })

  it('says just now under a minute, and never counts backwards', () => {
    assert.equal(relativeTime(now, now), 'just now')
    assert.equal(relativeTime(now + 60_000, now), 'just now')
  })
})

describe('absoluteTimeLabel', () => {
  // No locale argument, so the host decides: a German reader sees 01.08.2026,
  // an American one 8/1/2026, without the extension picking for them.
  it('follows the host conventions rather than a fixed format', () => {
    const label = absoluteTimeLabel(Date.UTC(2026, 7, 1, 12, 31))
    assert.match(label, /2026/)
    assert.match(label, /\d{1,2}[.\/-]\d{1,2}/)
    assert.match(label, /\d{1,2}:\d{2}/)
  })

  it('honours an explicit locale', () => {
    const at = Date.UTC(2026, 7, 1, 12, 31)
    assert.match(absoluteTimeLabel(at, 'de-DE'), /01\.08\.2026/)
    assert.match(absoluteTimeLabel(at, 'en-US'), /08\/01\/2026/)
  })

  // Two reindexes minutes apart are told apart by the minute; two a few
  // seconds apart are not, and those are exactly the ones under suspicion.
  it('carries seconds', () => {
    assert.match(absoluteTimeLabel(Date.UTC(2026, 7, 1, 12, 31, 47), 'de-DE'), /:31:47/)
  })

  // The setting is free text, and toLocaleString throws RangeError on a
  // malformed tag - "de_DE" with an underscore is the obvious typo. A throw
  // here would land in the refresh timer, which has no handler.
  for (const bad of ['de_DE', 'nonsense!!', '   ', 'xx-YY-ZZ-!!']) {
    it(`falls back rather than throwing on "${bad}"`, () => {
      assert.doesNotThrow(() => absoluteTimeLabel(Date.UTC(2026, 7, 1, 12, 31), bad))
      assert.match(absoluteTimeLabel(Date.UTC(2026, 7, 1, 12, 31), bad), /2026/)
    })
  }
})

describe('renderBody', () => {
  it('shows the setup call to action when no binary is present', () => {
    const state = computeState({
      source: 'auto',
      managedPath: null,
      externalPath: null,
    })
    const html = renderBody(model({ state }), 'n1')
    assert.match(html, /data-command="betterCmm.runSetup"/)
    assert.doesNotMatch(html, /class="action primary setup progress"/)
  })

  // A failed install names a log file, and setup is the screen the user is
  // left on, so it is the one screen that has to offer both logs.
  it('offers both logs on the setup screen, side by side', () => {
    const state = computeState({
      source: 'auto',
      managedPath: null,
      externalPath: null,
    })
    const html = renderBody(model({ state }), 'n1')
    assert.match(html, /data-command="betterCmm.showLogs"/)
    assert.match(html, /data-command="betterCmm.showEngineLogs"/)
    assert.match(html, /class="actions grid pair"/)
  })

  it('renders a running setup install as a filled bar with its percentage', () => {
    const state = computeState({
      source: 'auto',
      managedPath: null,
      externalPath: null,
    })
    const html = renderBody(model({ state, setupProgress: 42.4 }), 'n1')
    assert.match(html, /class="action primary setup progress"/)
    assert.match(html, /<span class="fill" style="width:42%">/)
    assert.match(html, /<span class="pct">42%<\/span>/)
  })

  it('names the step once the setup download is done', () => {
    const state = computeState({
      source: 'auto',
      managedPath: null,
      externalPath: null,
    })
    const html = renderBody(model({ state, setupProgress: 90 }), 'n1')
    assert.match(html, /<span class="pct">Installing\.\.\.<\/span>/)
  })

  it('hides the update button for an external binary', () => {
    const external = computeState({
      source: 'external',
      managedPath: null,
      externalPath: '/usr/bin/cmm',
    })
    // The command name also appears in the click handler script, which ships
    // unconditionally, so the assertion is on the button rather than the string.
    assert.doesNotMatch(
      renderBody(model({ state: external }), 'n1'),
      /data-command="betterCmm.updateBinary"/,
    )
  })

  it('tells an external binary about a release without offering to install it', () => {
    const external = computeState({
      source: 'external',
      managedPath: null,
      externalPath: '/usr/bin/cmm',
    })
    const html = renderBody(model({ state: external, updateAvailable: '0.9.1' }), 'n1')
    assert.match(html, /class="action warning hint" title="[^"]*update it yourself/)
    assert.doesNotMatch(html, /data-command="betterCmm.updateBinary"/)
    // The notes are worth reading whoever installs the release.
    assert.match(html, /href="https:\/\/github.com\/[^"]+\/releases\/tag\/v0\.9\.1"/)
  })

  it('names the step once the download is done rather than holding at a number', () => {
    const html = renderBody(model({ updateAvailable: '0.9.1', updateProgress: 90 }), 'n1')
    assert.match(html, /<span class="pct">Installing\.\.\.<\/span>/)
  })

  it('announces an available update', () => {
    assert.match(renderBody(model({ updateAvailable: '0.9.1' }), 'n1'), /0\.9\.1/)
  })

  it('colours the update button as a warning and links the release notes', () => {
    const html = renderBody(model({ updateAvailable: '0.9.1' }), 'n1')
    assert.match(html, /class="action warning update" data-command="betterCmm.updateBinary"/)
    assert.match(html, /href="https:\/\/github.com\/[^"]+\/releases\/tag\/v0\.9\.1"/)
  })

  it('leaves the update button idle when no update is running', () => {
    const html = renderBody(model({ updateAvailable: '0.9.1' }), 'n1')
    assert.doesNotMatch(html, /class="action warning update progress"/)
    assert.match(html, /<span class="fill" style="width:0%">/)
  })

  it('renders a running update as a filled bar with its percentage', () => {
    const html = renderBody(model({ updateAvailable: '0.9.1', updateProgress: 42.4 }), 'n1')
    assert.match(html, /class="action warning update progress"/)
    assert.match(html, /<span class="fill" style="width:42%">/)
    assert.match(html, /<span class="pct">42%<\/span>/)
  })

  it('clamps a percentage the install path should never report', () => {
    const html = renderBody(model({ updateAvailable: '0.9.1', updateProgress: 130 }), 'n1')
    assert.match(html, /<span class="fill" style="width:100%">/)
  })

  it('drops the release notes link for a version that is not a plain tag', () => {
    const html = renderBody(model({ updateAvailable: '0.9.1 <script>' }), 'n1')
    assert.match(html, /betterCmm.updateBinary/)
    assert.doesNotMatch(html, /releases\/tag\//)
  })

  it('renders the project rows', () => {
    const html = renderBody(
      model({ projects: [{ name: 'app', root_path: 'D:/Repos/app', nodes: 12, edges: 34 }] }),
      'n1',
    )
    assert.match(html, /D:\/Repos\/app/)
    assert.match(html, /12/)
    assert.match(html, /34/)
  })

  // The field names below are the CLI's own (`root_path`, `nodes`, `edges`).
  // Renaming them in ProjectSummary is what silently blanked the card before,
  // so assert the real payload shape renders, not a convenient local shape.
  it('renders the real CLI payload shape, not a renamed one', () => {
    const html = renderBody(
      model({
        projects: [
          { name: 'D-Hold-VS-Code', root_path: 'D:/Hold/VS Code', nodes: 19768, edges: 53018 },
        ],
      }),
      'n1',
    )
    assert.match(html, /D:\/Hold\/VS Code/)
    assert.match(html, /19,768/)
    assert.match(html, /53,018/)
  })

  it('totals the metric cards across every project', () => {
    const html = renderBody(
      model({
        projects: [
          { name: 'a', root_path: '/a', nodes: 10, edges: 20, size_bytes: 1024 },
          { name: 'b', root_path: '/b', nodes: 5, edges: 7, size_bytes: 1024 },
        ],
      }),
      'n1',
    )
    assert.match(html, /15/)
    assert.match(html, /27/)
    // The third tile counts projects, per the spec - it replaces the reference
    // extension's always-empty Uptime tile. Per-project size stays on the card.
    assert.match(html, /<div class="metric-value">2<\/div>/)
    assert.match(html, /Projects/)
    assert.match(html, /1\.0 KB/)
  })

  it('shows a skeleton instead of an empty list while the CLI is still running', () => {
    const html = renderBody(model({ loading: true }), 'n1')
    assert.match(html, /skeleton/)
    assert.doesNotMatch(html, /no projects/i)
  })

  it('reports the MCP server in the header chip, never a server run state', () => {
    assert.match(renderBody(model(), 'n1'), /chip ok[^>]*>.*?registered/s)
    const setup = computeState({
      source: 'auto',
      managedPath: null,
      externalPath: null,
    })
    const html = renderBody(model({ state: setup }), 'n1')
    assert.match(html, /no binary/)
    // Variant C: the extension does not own the server process, so it must
    // never claim one is running or offer to start one.
    assert.doesNotMatch(html, /start.{0,12}server/i)
    assert.doesNotMatch(html, /\buptime\b/i)
  })

  it('escapes a project name so markup in it cannot execute', () => {
    const html = renderBody(
      model({ projects: [{ name: '<script>alert(1)</script>', root_path: '/x' }] }),
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
    })
    assert.match(renderBody(model({ state: fallback }), 'n1'), /falling back/i)
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
    }
    const html = renderBody(model({ state }), 'n1')
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  describe('project cards', () => {
    const card = (root: string, branch?: string): string =>
      renderBody(
        model({
          projects: [
            {
              name: 'D-Hold-VS-Code-openrouter-model-list',
              root_path: root,
              nodes: 1,
              edges: 1,
              ...(branch === undefined ? {} : { git: { branch } }),
            },
          ],
        }),
        'n1',
      )

    it('titles the card with the folder, not the hyphenated CLI name', () => {
      const html = card('D:/Hold/VS Code/openrouter-model-list')
      assert.match(html, /class="card-name"[^>]*>openrouter-model-list</)
      // The CLI name is still reachable, because commands need it verbatim.
      assert.match(html, /Project name: D-Hold-VS-Code-openrouter-model-list/)
    })

    it('shows the parent folder rather than repeating the full path', () => {
      const html = card('D:/Hold/VS Code/openrouter-model-list')
      assert.match(html, /class="card-path"[^>]*>D:\/Hold\/VS Code</)
    })

    it('explains DETACHED rather than leaving it as a bare word', () => {
      assert.match(card('/a/b', 'DETACHED'), /detached HEAD/)
    })

    it('names the branch for an ordinary checkout', () => {
      assert.match(card('/a/b', 'main'), /Git branch indexed: main/)
    })
  })

  describe('actions layout', () => {
    it('groups the actions into rows rather than one column', () => {
      const html = renderBody(model({ projects: [{ name: 'a', root_path: '/a' }] }), 'n1')
      const rows = html.match(/class="actions grid"/g) ?? []
      assert.equal(rows.length, 2, 'expected a project row and a log row')
      assert.match(html, /Reindex all projects/)
    })

    it('omits the reindex-all action when nothing is indexed', () => {
      const html = renderBody(model({ projects: [] }), 'n1')
      assert.doesNotMatch(html, /Reindex all projects/)
    })
  })

  describe('project freshness', () => {
    it('offers a per-project reindex beside the remove button', () => {
      const html = renderBody(model({ projects: [{ name: 'a', root_path: '/a' }] }), 'n1')
      assert.match(html, /data-command="betterCmm.reindexProject" data-project="a"/)
      assert.match(html, /Rescans its files/)
    })

    it('says when the index was last built', () => {
      const html = renderBody(
        model({
          projects: [{ name: 'a', root_path: '/a', indexed_at_ms: Date.now() - 7200000 }],
        }),
        'n1',
      )
      assert.match(html, /2h ago/)
    })

    it('shows the absolute time when the setting asks for it, with the age on hover', () => {
      const at = Date.UTC(2026, 7, 1, 12, 31)
      const relative = renderBody(
        model({ projects: [{ name: 'a', root_path: '/a', indexed_at_ms: at }] }),
        'n1',
      )
      const absolute = renderBody(
        model({
          projects: [{ name: 'a', root_path: '/a', indexed_at_ms: at }],
          absoluteTime: true,
        }),
        'n1',
      )
      // Whichever form is shown, the other one is the tooltip.
      assert.match(relative, /ago<\/span>/)
      assert.match(relative, /title="Index last updated: [0-9]/)
      assert.match(absolute, /title="Index last updated: [0-9]+h( [0-9]+m)? ago"/)
    })

    // The extension decides staleness and passes the answer in. It cannot be
    // read off `git.base_sha`: that value never advances, so a reindex left
    // the project marked outdated for good.
    it('marks an index the extension reported as behind the checkout', () => {
      const html = renderBody(
        model({ projects: [{ name: 'a', root_path: '/a', stale: true }] }),
        'n1',
      )
      assert.match(html, /outdated/)
      assert.match(html, /built from an earlier commit/)
    })

    it('says nothing when the index matches the checkout', () => {
      const html = renderBody(
        model({ projects: [{ name: 'a', root_path: '/a', stale: false }] }),
        'n1',
      )
      assert.doesNotMatch(html, /outdated/)
    })

    // A differing base_sha must not resurrect the old, permanently-true claim.
    it('ignores base_sha, which the CLI never advances', () => {
      const html = renderBody(
        model({
          projects: [
            { name: 'a', root_path: '/a', git: { base_sha: 'aaaa1111', head_sha: 'bbbb2222' } },
          ],
        }),
        'n1',
      )
      assert.doesNotMatch(html, /outdated/)
    })

    it('says nothing when the extension has no record to compare against', () => {
      const html = renderBody(model({ projects: [{ name: 'a', root_path: '/a' }] }), 'n1')
      assert.doesNotMatch(html, /outdated/)
    })

    it('says nothing about freshness when the CLI reported nothing', () => {
      const html = renderBody(model({ projects: [{ name: 'a', root_path: '/a' }] }), 'n1')
      assert.doesNotMatch(html, /card-age/)
    })
  })

  describe('settings screen', () => {
    const settingsModel = (cliSettings: PanelModel['cliSettings']): PanelModel => ({
      state: {
        kind: 'ready-managed',
        activePath: '/bin/cmm',
        effectiveSource: 'managed',
        notice: null,
      },
      projects: [],
      version: '0.9.0',
      updateAvailable: null,
      view: 'settings',
      cliSettings,
    })

    it('offers a two-option select for a boolean, not free text', () => {
      const html = renderBody(
        settingsModel([
          { key: 'auto_watch', value: 'true', default: 'true', description: 'Watch git' },
        ]),
        'n1',
      )
      assert.match(html, /<select class="ctl" data-setting="auto_watch">/)
      assert.match(html, /<option value="true" selected>/)
      assert.match(html, /<option value="false">/)
    })

    it('uses a text field for a non-boolean', () => {
      const html = renderBody(
        settingsModel([
          { key: 'auto_index_limit', value: '50000', default: '50000', description: '' },
        ]),
        'n1',
      )
      assert.match(html, /<input class="ctl" type="text" data-setting="auto_index_limit"/)
    })

    it('marks a value that no longer matches its default', () => {
      const html = renderBody(
        settingsModel([{ key: 'auto_watch', value: 'false', default: 'true', description: '' }]),
        'n1',
      )
      assert.match(html, /modified/)
      assert.match(html, /Default: true/)
    })

    it('keeps the uninstall action out of the ordinary settings list', () => {
      const html = renderBody(settingsModel([]), 'n1')
      assert.match(html, /<section class="danger">/)
      assert.match(html, /also removes the entries its own install wrote/)
    })

    it('shows the command inline rather than linking to another screen', () => {
      const html = renderBody(settingsModel([]), 'n1')
      assert.match(html, /class="cmd"/)
      assert.doesNotMatch(html, /data-command="betterCmm\.showUninstall"/)
    })

    it('offers PowerShell and Git Bash separately on Windows, each with its own copy', () => {
      const html = renderBody(
        { ...settingsModel([]), platform: 'win32', gitBashAvailable: true },
        'n1',
      )
      assert.match(html, /PowerShell/)
      assert.match(html, /Git Bash/)
      assert.match(html, /data-command="betterCmm\.copyUninstallCommand"/)
      assert.match(html, /data-command="betterCmm\.copyUninstallCommandBash"/)
      // The call operator is PowerShell-only; the bash line uses forward slashes.
      assert.match(html, /&amp; &quot;\/bin\/cmm&quot; uninstall/)
    })

    it('omits the Git Bash line when no Git Bash was found', () => {
      const html = renderBody(
        { ...settingsModel([]), platform: 'win32', gitBashAvailable: false },
        'n1',
      )
      assert.doesNotMatch(html, /Git Bash/)
      assert.doesNotMatch(html, /copyUninstallCommandBash/)
    })

    it('offers one line only off Windows', () => {
      const html = renderBody({ ...settingsModel([]), platform: 'linux' }, 'n1')
      assert.match(html, /Terminal/)
      assert.doesNotMatch(html, /PowerShell/)
    })

    it('offers to remove the managed copy only when there is one', () => {
      const withCopy = renderBody({ ...settingsModel([]), managedBinaryPresent: true }, 'n1')
      assert.match(withCopy, /data-command="betterCmm\.removeManagedBinary"/)
      const without = renderBody({ ...settingsModel([]), managedBinaryPresent: false }, 'n1')
      assert.doesNotMatch(without, /removeManagedBinary/)
    })

    it('escapes a hostile setting key and value', () => {
      const html = renderBody(
        settingsModel([{ key: XSS_PAYLOAD, value: XSS_PAYLOAD, default: '', description: '' }]),
        'n1',
      )
      assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    })
  })

  // The toast that says so is collapsed by default, and the update is taken
  // from the panel, so the panel is where the user is looking. Nothing is said
  // about registering: the definition is provided, so only the running process
  // is behind.
  it('warns in the panel that the new binary needs the server restarted', () => {
    const html = renderBody(model({ restartRequired: 'binary' }), 'n1')
    assert.match(html, /Restart the MCP server to run the new binary/)
    assert.doesNotMatch(html, /finish registering/)
  })

  it('does not offer a second Refresh beside the one in the title bar', () => {
    const html = renderBody(model({}), 'n1')
    assert.doesNotMatch(html, /data-command="betterCmm\.refresh"/)
  })


  it('escapes a hostile git branch (also straight from the CLI)', () => {
    const html = renderBody(
      model({
        projects: [
          { name: 'a', root_path: '/a', git: { branch: XSS_PAYLOAD } },
        ],
      }),
      'n1',
    )
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  it('escapes a hostile version and updateAvailable (both come from the CLI)', () => {
    // The version strings are CLI stdout and a GitHub release tag - untrusted
    // like every other field, and updateAvailable additionally lands inside a
    // button label rather than plain text.
    const html = renderBody(
      model({ version: XSS_PAYLOAD, updateAvailable: XSS_PAYLOAD }),
      'n1',
    )
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  it('escapes a hostile project path', () => {
    const html = renderBody(
      model({ projects: [{ name: 'app', root_path: XSS_PAYLOAD }] }),
      'n1',
    )
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  // --- Security case (b): attribute-context escaping for data-project ---

  it('cannot break out of the data-project attribute with quotes/backtick', () => {
    const hostileName = '" onmouseover="alert(1)'
    const html = renderBody(model({ projects: [{ name: hostileName, root_path: '/x' }] }), 'n1')

    // The literal payload must not appear unescaped (a real, unescaped
    // attribute-boundary quote followed by a live onmouseover=" attribute).
    assert.doesNotMatch(html, /data-project="" onmouseover="alert\(1\)"/)

    // Extract the remove button's opening tag and confirm it parses as
    // exactly one element with exactly one data-project attribute value
    // that round-trips to the original hostile string once unescaped.
    const buttonMatch = /<button[^>]*data-command="betterCmm.removeProject"[^>]*>/.exec(html)
    assert.ok(buttonMatch, 'expected a remove button in the output')
    const tag = buttonMatch[0]

    // Count raw (unescaped) double quotes: exactly two per attribute, and the
    // tag carries five (class, title, aria-label, data-command, data-project).
    // An injected attribute would push this past ten.
    const rawQuoteCount = (tag.match(/"/g) ?? []).length
    assert.equal(rawQuoteCount, 10, `expected exactly 10 raw quotes in tag, got: ${tag}`)

    // No live onmouseover attribute was injected - only inert escaped text
    // inside the data-project value is permitted, never a real "onmouseover=".
    assert.doesNotMatch(tag, /\bonmouseover\s*="/)

    const dataProjectMatch = /data-project="([^"]*)"/.exec(tag)
    assert.ok(dataProjectMatch, 'expected a single well-formed data-project attribute')
    assert.equal(dataProjectMatch[1], '&quot; onmouseover=&quot;alert(1)')
  })

  it('cannot break out of the data-project attribute with a single quote or backtick', () => {
    const hostileName = `'`+'`'+`onmouseover=alert(1)`
    const html = renderBody(model({ projects: [{ name: hostileName, root_path: '/x' }] }), 'n1')
    const buttonMatch = /<button[^>]*data-command="betterCmm.removeProject"[^>]*>/.exec(html)
    assert.ok(buttonMatch)
    const tag = buttonMatch[0]
    // Exactly one data-project attribute, still a single well-formed tag -
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
      }), // needs-setup
      computeState({
        source: 'managed',
        managedPath: MANAGED,
        externalPath: null,
      }), // ready-managed
      computeState({
        source: 'external',
        managedPath: null,
        externalPath: '/usr/bin/cmm',
      }), // ready-external
      computeState({
        source: 'external',
        managedPath: MANAGED,
        externalPath: null,
      }), // fallback-managed
    ]

    const kinds = variants.map((s) => s.kind)
    assert.deepEqual(
      new Set(kinds),
      new Set(['needs-setup', 'ready-managed', 'ready-external', 'fallback-managed']),
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
