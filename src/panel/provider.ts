import * as vscode from 'vscode'
import { contentSecurityPolicy, renderBody, type PanelModel } from './html'

function makeNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class PanelProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'betterCmm.panel'

  private view: vscode.WebviewView | undefined
  private model: PanelModel | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onCommand: (command: string, project: string | undefined) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] }
    view.webview.onDidReceiveMessage((message: { command?: unknown; project?: unknown }) => {
      if (typeof message.command === 'string') {
        this.onCommand(
          message.command,
          typeof message.project === 'string' ? message.project : undefined,
        )
      }
    })
    this.render()
  }

  update(model: PanelModel): void {
    this.model = model
    this.render()
  }

  /** True while the panel is on screen. Polling pauses when it is not. */
  get isVisible(): boolean {
    return this.view?.visible ?? false
  }

  private render(): void {
    if (this.view === undefined || this.model === undefined) {
      return
    }
    const nonce = makeNonce()
    const csp = contentSecurityPolicy(nonce, this.view.webview.cspSource)
    this.view.webview.html =
      `<!DOCTYPE html><html><head>` +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `</head><body>${renderBody(this.model, nonce)}</body></html>`
  }
}
