import { BINARY_BASE } from '../constants'

/**
 * Where Git Bash lives when it is installed.
 *
 * Checked rather than assumed: offering a Git Bash command line to someone
 * who has no Git Bash is worse than offering only PowerShell.
 */
export function gitBashCandidates(env: {
  programFiles?: string | undefined
  programFilesX86?: string | undefined
  localAppData?: string | undefined
}): string[] {
  const roots = [env.programFiles, env.programFilesX86, env.localAppData]
    .filter((root): root is string => typeof root === 'string' && root.length > 0)
    .map((root) => root.replace(/\\/g, '/'))
  return roots.flatMap((root) => [`${root}/Git/bin/bash.exe`, `${root}/Programs/Git/bin/bash.exe`])
}

/**
 * Where a PATH entry for the CLI belongs.
 *
 * `~/.local/bin` is on PATH on every platform the extension supports and is
 * where the CLI's own installer puts itself, so a shim placed here takes the
 * same slot rather than competing for it.
 */
export function shimDirectory(home: string): string {
  return `${home.replace(/\\/g, '/')}/.local/bin`
}

/**
 * The shim's file name.
 *
 * On Windows a `.cmd` is enough to be found by PATHEXT and needs no compiler,
 * but it loses to a `.exe` of the same stem, so the full copy the CLI installs
 * has to be removed for the shim to take effect.
 */
export function shimPath(home: string, platform: NodeJS.Platform): string {
  const extension = platform === 'win32' ? '.cmd' : ''
  return `${shimDirectory(home)}/${BINARY_BASE}${extension}`
}

/** The full copy the CLI's own installer leaves on PATH, which the shim replaces. */
export function installedCopyPath(home: string, platform: NodeJS.Platform): string {
  const extension = platform === 'win32' ? '.exe' : ''
  return `${shimDirectory(home)}/${BINARY_BASE}${extension}`
}

/**
 * Contents of the shim.
 *
 * A shim rather than a second full copy: the binary is ~36 MB, and two copies
 * drift apart the moment one of them is updated. Forwarding keeps the managed
 * install the only real one.
 *
 * `%*` and `"$@"` forward arguments with their quoting intact, which matters
 * because project paths contain spaces.
 */
export function shimContents(targetPath: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    // @echo off so the shim itself never appears in output the CLI's callers
    // parse, and a plain call so the exit code passes straight through.
    //
    // `%%` is the literal percent in a batch file: cmd.exe expands `%VAR%`
    // even inside double quotes, and a percent is legal in a Windows account
    // name, so an unescaped one silently rewrites the path.
    const windowsPath = targetPath.replace(/\//g, '\\').replace(/%/g, '%%')
    return `@echo off\r\n"${windowsPath}" %*\r\n`
  }
  // Single quotes, not double: inside double quotes a shell still acts on `$`,
  // a backtick and a backslash, and all three are legal in a POSIX path. The
  // replacement is the standard way to carry a single quote through them.
  return `#!/bin/sh\nexec '${targetPath.replace(/'/g, "'\\''")}' "$@"\n`
}

/**
 * Whether a path is one this extension may replace or delete.
 *
 * Deleting outside the extension's own storage needs a hard rule, not a
 * judgement call: only the exact shim and the exact copy the CLI installs, in
 * that one directory, and nothing else.
 */
export function mayReplace(path: string, home: string, platform: NodeJS.Platform): boolean {
  const normalized = path.replace(/\\/g, '/')
  return (
    normalized === shimPath(home, platform) || normalized === installedCopyPath(home, platform)
  )
}
