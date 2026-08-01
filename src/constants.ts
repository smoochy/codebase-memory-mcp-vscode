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
 * Characters a shell still acts on inside double quotes, plus anything that
 * would submit the line before the user can read it.
 *
 * A backslash is deliberately absent — every Windows path contains one — and
 * so is the space, which is the whole reason the value gets quoted.
 */
const REJECTED_IN_PATH = /["`$\r\n\t]/

/**
 * The uninstall command bound to a known binary.
 *
 * The bare name only works when the binary is on PATH, which it need not be:
 * a managed install lives in the extension's own storage and is never added to
 * PATH, so the plain command failed with "not recognised" for exactly the
 * users who had not installed the CLI themselves.
 *
 * The path is only ever quoted, never escaped, and this string is handed to
 * the user to paste into a shell. A path that could break out of those quotes
 * therefore never reaches the clipboard at all; the bare command is the safe
 * fallback. `betterCmm.externalBinaryPath` is machine-scoped for the same
 * reason, so a repository cannot choose the value in the first place.
 */
export function uninstallCommandFor(
  binaryPath: string | null,
  platform: NodeJS.Platform = process.platform,
): string {
  if (binaryPath === null || REJECTED_IN_PATH.test(binaryPath)) {
    return UNINSTALL_COMMAND
  }
  // PowerShell is the default terminal on Windows, and there a quoted string in
  // command position is a parse error without the call operator. cmd.exe has
  // the opposite rule, so no single spelling suits both and the default shell
  // wins.
  return platform === 'win32' ? `& "${binaryPath}" uninstall` : `"${binaryPath}" uninstall`
}
