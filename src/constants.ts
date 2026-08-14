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

/**
 * Backoff before each retry of a failed request, in milliseconds. Its length is
 * the attempt bound: two entries mean three attempts.
 *
 * The budget is per request, and `followRedirects` issues one request per hop,
 * so a chain that hits `MAX_REDIRECTS` can spend this budget that many times
 * over. That is accepted rather than tracked: a total budget would have to be
 * threaded through the redirect loop, and the case it guards against needs five
 * hops and a failure on each.
 */
export const RETRY_BACKOFF_MS: readonly number[] = [250, 1000]

/** Longest a `Retry-After` header may hold a request, in milliseconds. */
export const RETRY_AFTER_CAP_MS = 1000

/**
 * Attempts at reading a response body before giving up.
 *
 * A stream that dies after the headers throws outside the request itself, so
 * the per-request retry above cannot see it. There is no extra backoff here:
 * the inner retry has already waited.
 */
export const DOWNLOAD_ATTEMPTS = 2

/** Keys `codebase-memory-mcp install` may use for its MCP server entry. */
export const MCP_SERVER_KEYS: readonly string[] = ['codebase-memory-mcp', 'codebase-memory']

export const UNINSTALL_COMMAND = 'codebase-memory-mcp uninstall'

/** The stop the panel asks for when a daemon of the replaced build is still up. */
export const DAEMON_STOP_COMMAND = 'codebase-memory-mcp daemon stop'

/**
 * Characters a shell still acts on inside double quotes, plus anything that
 * would submit the line before the user can read it.
 *
 * A backslash is deliberately absent - every Windows path contains one - and
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
  return commandFor(binaryPath, 'uninstall', UNINSTALL_COMMAND, platform)
}

function commandFor(
  binaryPath: string | null,
  subcommand: string,
  bare: string,
  platform: NodeJS.Platform,
): string {
  if (binaryPath === null || REJECTED_IN_PATH.test(binaryPath)) {
    return bare
  }
  // PowerShell is the default terminal on Windows, and there a quoted string in
  // command position is a parse error without the call operator. cmd.exe has
  // the opposite rule, so no single spelling suits both and the default shell
  // wins.
  return platform === 'win32' ? `& "${binaryPath}" ${subcommand}` : `"${binaryPath}" ${subcommand}`
}

/**
 * The same command for a POSIX shell running on Windows.
 *
 * Git Bash is common enough on Windows that offering only the PowerShell
 * spelling means half the users paste a line their shell cannot parse. It
 * takes forward slashes and no call operator.
 */
export function uninstallCommandForBash(binaryPath: string | null): string {
  return bashCommandFor(binaryPath, 'uninstall', UNINSTALL_COMMAND)
}

function bashCommandFor(binaryPath: string | null, subcommand: string, bare: string): string {
  if (binaryPath === null || REJECTED_IN_PATH.test(binaryPath)) {
    return bare
  }
  return `"${binaryPath.replace(/\\/g, '/')}" ${subcommand}`
}

/**
 * `daemon stop`, bound to the same binary for the same reason as the uninstall:
 * the panel asks for this one when the daemon of the replaced build is still up,
 * and a managed install is never on PATH, so the bare name would fail for
 * exactly the users the notice is shown to.
 */
export function daemonStopCommandFor(
  binaryPath: string | null,
  platform: NodeJS.Platform = process.platform,
): string {
  return commandFor(binaryPath, 'daemon stop', DAEMON_STOP_COMMAND, platform)
}

export function daemonStopCommandForBash(binaryPath: string | null): string {
  return bashCommandFor(binaryPath, 'daemon stop', DAEMON_STOP_COMMAND)
}
