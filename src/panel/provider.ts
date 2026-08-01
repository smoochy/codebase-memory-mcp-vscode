import * as vscode from 'vscode'
import type { CliSetting } from '../cli/configParse'
import { contentSecurityPolicy, renderBody, PANEL_CSS, type PanelModel } from './html'

function makeNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class PanelProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'betterCmm.panel'

  private view: vscode.WebviewView | undefined
  private model: PanelModel | undefined
  private lastHtml = ''
  private view_: 'main' | 'settings' = 'main'
  private cliSettings: CliSetting[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onCommand: (
      command: string,
      project: string | undefined,
      value?: string,
    ) => void,
    /** Shown in the header, including on the skeleton rendered before the
     * first CLI call returns. */
    private readonly extensionVersion: string | null = null,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] }
    view.webview.onDidReceiveMessage(
      (message: { command?: unknown; project?: unknown; value?: unknown }) => {
        if (typeof message.command === 'string') {
          this.onCommand(
            message.command,
            typeof message.project === 'string' ? message.project : undefined,
            typeof message.value === 'string' ? message.value : undefined,
          )
        }
      },
    )
    this.render()
  }

  update(model: PanelModel): void {
    // The view is panel state, not CLI state, so a refresh landing while the
    // uninstall screen is open must not throw the user back to the main view.
    this.model = { ...model, view: this.view_, cliSettings: this.cliSettings }
    this.render()
  }

  /**
   * Store the CLI's settings for the settings screen.
   *
   * Held separately from `update`, which runs on the refresh timer: reading
   * them costs two extra process launches, so it happens when the screen is
   * opened or a value is written, not every thirty seconds.
   */
  updateCliSettings(cliSettings: CliSetting[]): void {
    this.cliSettings = cliSettings
    if (this.model !== undefined) {
      this.model = { ...this.model, cliSettings }
    }
    this.render()
  }

  /** Switch between the main panel and a full-screen view. */
  setView(view: 'main' | 'settings'): void {
    this.view_ = view
    if (this.model !== undefined) {
      this.model = { ...this.model, view }
    }
    this.render()
  }

  /** True while the panel is on screen. Polling pauses when it is not. */
  get isVisible(): boolean {
    return this.view?.visible ?? false
  }

  /**
   * True while a full-screen view is open.
   *
   * A render replaces the whole document, so a timed refresh landing while the
   * user is typing in a settings field discards what they had typed. Polling
   * pauses until they leave the screen; nothing on these screens changes on a
   * timer anyway.
   */
  get isOnSubScreen(): boolean {
    return this.view_ !== 'main'
  }

  /**
   * The markup last handed to VS Code.
   *
   * Exposed so an integration test can assert on what the running extension
   * host actually rendered. Re-rendering from source in a test would miss the
   * failure this exists to catch: a packaged bundle built from stale source,
   * where every source-level test passes and the installed panel is still the
   * old one.
   */
  get renderedHtml(): string {
    return this.lastHtml
  }

  private render(): void {
    if (this.view === undefined) {
      return
    }
    // The first CLI call takes seconds. Rendering the skeleton rather than
    // returning early is what stops the panel from looking blank and broken
    // while it runs.
    const model: PanelModel = this.model ?? {
      state: {
        kind: 'ready-managed',
        activePath: null,
        effectiveSource: 'managed',
        notice: null,
        pathConflict: null,
      },
      projects: [],
      version: null,
      updateAvailable: null,
      extensionVersion: this.extensionVersion,
      loading: true,
      view: this.view_,
      cliSettings: this.cliSettings,
    }
    const nonce = makeNonce()
    const csp = contentSecurityPolicy(nonce, this.view.webview.cspSource)
    this.lastHtml =
      `<!DOCTYPE html><html><head>` +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<style nonce="${nonce}">${PANEL_CSS}</style>` +
      `</head><body>${renderBody(model, nonce)}</body></html>`
    this.view.webview.html = this.lastHtml
  }
}
