export const UPSTREAM = {
  owner: 'DeusData',
  repo: 'codebase-memory-mcp',
} as const

/** Base name of the CLI binary, without platform extension. */
export const BINARY_BASE = 'codebase-memory-mcp'

/** Hosts a release download is allowed to touch. Exact match, lowercase. */
export const ALLOWED_HOSTS: readonly string[] = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]

export const MAX_REDIRECTS = 5

/** Keys `codebase-memory-mcp install` may use for its MCP server entry. */
export const MCP_SERVER_KEYS: readonly string[] = ['codebase-memory-mcp', 'codebase-memory']

export const INSTALL_COMMAND = 'codebase-memory-mcp install'
export const UNINSTALL_COMMAND = 'codebase-memory-mcp uninstall'

/**
 * The same command bound to a known binary.
 *
 * The bare name only works when the binary is on PATH, which it need not be —
 * a managed install lives in the extension's own storage and is never added to
 * PATH, so the plain command simply failed with "not recognised". Quoting is
 * unconditional because the managed path contains spaces on most installs.
 */
export function uninstallCommandFor(binaryPath: string | null): string {
  return binaryPath === null ? UNINSTALL_COMMAND : `"${binaryPath}" uninstall`
}
