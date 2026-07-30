import { binaryFileName } from './assets'

export interface LocateEnv {
  platform: NodeJS.Platform
  home: string
  /** Raw PATH variable. */
  pathVar: string
  /** Separator for PATH entries, `;` on Windows and `:` elsewhere. */
  pathSeparator: string
}

/** Join with forward slashes so the results compare cleanly across platforms. */
function join(...parts: string[]): string {
  return parts.map((p) => p.replace(/[\\/]+$/, '')).join('/')
}

/**
 * Whether a raw PATH entry is absolute, per the injected platform rather than
 * the host running this code. A relative entry resolves against the process's
 * cwd, which an attacker can control — reject it instead of resolving it.
 */
function isAbsolute(dir: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(dir) || /^[\\/]{2}/.test(dir)
  }
  return dir.startsWith('/')
}

/**
 * Where a user-installed binary may live, most likely first.
 *
 * PATH is scanned last: a well known location is a stronger signal than a
 * directory that merely happens to be on PATH.
 */
export function externalCandidates(env: LocateEnv): string[] {
  const name = binaryFileName(env.platform)
  const home = env.home.replace(/\\/g, '/')
  const wellKnown: string[] = [join(home, '.local/bin', name)]

  if (env.platform === 'win32') {
    wellKnown.push(
      join(home, 'AppData/Local/codebase-memory-mcp', name),
      join(home, 'bin', name),
    )
  } else {
    if (env.platform === 'darwin') {
      wellKnown.push('/opt/homebrew/bin/' + name)
    }
    wellKnown.push('/usr/local/bin/' + name, join(home, 'bin', name))
  }

  wellKnown.push(join(home, '.cargo/bin', name))

  const fromPath = env.pathVar
    .split(env.pathSeparator)
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0 && isAbsolute(dir, env.platform))
    .map((dir) => join(dir.replace(/\\/g, '/'), name))

  return [...new Set([...wellKnown, ...fromPath])]
}

/** Where the extension keeps the binary it manages itself. */
export function managedBinaryPath(storageDir: string, platform: NodeJS.Platform): string {
  return join(storageDir.replace(/\\/g, '/'), 'bin', binaryFileName(platform))
}

/**
 * First candidate that exists. A candidate whose check throws, for instance an
 * unreadable directory, is skipped rather than aborting the whole search.
 */
export function findFirstExisting(
  candidates: string[],
  exists: (p: string) => boolean,
): string | null {
  for (const candidate of candidates) {
    try {
      if (exists(candidate)) {
        return candidate
      }
    } catch {
      continue
    }
  }
  return null
}
