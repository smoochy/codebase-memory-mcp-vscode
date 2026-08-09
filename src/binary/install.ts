export interface FileOps {
  exists(p: string): boolean
  rename(from: string, to: string): void
  write(p: string, data: Uint8Array): void
  remove(p: string): void
  chmod(p: string, mode: number): void
  mkdirp(p: string): void
}

/**
 * Which `tar` to run.
 *
 * Windows ships bsdtar as `System32\tar.exe` and it is named in full, because
 * bare `tar` resolves through PATH and Git for Windows puts GNU tar ahead of
 * it. GNU tar reads `D:\...` as `host:path` and answers a local archive with
 * "Cannot connect to D: resolve failed", so which tar runs is not the user's
 * PATH order to decide. Naming it in full also means no earlier PATH entry can
 * substitute a different program for it.
 *
 * Elsewhere `tar` is the system's own and PATH is the right way to find it.
 */
export function tarCommand(
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
  exists: (p: string) => boolean,
): string {
  if (platform !== 'win32') {
    return 'tar'
  }
  const bsdtar = `${(systemRoot ?? 'C:\\Windows').replace(/\\/g, '/').replace(/\/+$/, '')}/System32/tar.exe`
  return exists(bsdtar) ? bsdtar : 'tar'
}

/**
 * Command that unpacks the release archive.
 *
 * `tar` handles both formats and ships with Windows 10 build 17063 and later,
 * so no extraction dependency is needed. The caller runs this via `spawn`
 * without a shell, so the paths are passed as arguments, never interpolated.
 */
export function extractCommand(
  archive: string,
  targetDir: string,
  command = 'tar',
): { command: string; args: string[] } {
  if (archive.endsWith('.tar.gz')) {
    return { command, args: ['-xzf', archive, '-C', targetDir] }
  }
  if (archive.endsWith('.zip')) {
    return { command, args: ['-xf', archive, '-C', targetDir] }
  }
  throw new Error(`unsupported archive format: ${archive}`)
}

function parentDir(p: string): string {
  const index = p.replace(/\\/g, '/').lastIndexOf('/')
  return index <= 0 ? p : p.slice(0, index)
}

/**
 * Put the binary in place.
 *
 * Windows refuses to overwrite a running executable but allows renaming it,
 * so the old file moves aside first. If the write then fails the old file is
 * renamed back, leaving a working installation behind.
 */
export function replaceBinary(
  target: string,
  data: Uint8Array,
  platform: NodeJS.Platform,
  ops: FileOps,
): void {
  ops.mkdirp(parentDir(target))

  // Stage beside the target, then rename onto it. The destination is a
  // directory on PATH now, so a direct write would truncate the live binary
  // and leave a partial, executable file behind on any interruption - and it
  // would follow a symlink at that name, writing the release bytes through it
  // and marking the link's target executable. A rename replaces the name
  // itself, atomically, and never follows.
  const staged = `${target}.new`
  try {
    ops.remove(staged)
  } catch {
    // Not there, which is the normal case.
  }
  ops.write(staged, data)
  if (platform !== 'win32') {
    ops.chmod(staged, 0o755)
  }

  const backup = `${target}.old`
  let movedAside = false

  if (platform === 'win32' && ops.exists(target)) {
    // A leftover backup from an interrupted update would block the rename.
    if (ops.exists(backup)) {
      try {
        ops.remove(backup)
      } catch {
        // Still locked by a running process. The rename below will report it.
      }
    }
    try {
      ops.rename(target, backup)
    } catch (cause) {
      // Nothing has been replaced yet, so the only trace to clear is the file
      // staged above; saying so is what keeps a locked binary from reading as
      // a half-finished install.
      try {
        ops.remove(staged)
      } catch {
        // Leftover scratch next to the target; harmless and replaced next time.
      }
      throw new Error(
        `the installed binary could not be moved aside, so it is unchanged and still in use: ${String(cause)}`,
        { cause },
      )
    }
    movedAside = true
  }

  try {
    ops.rename(staged, target)
  } catch (cause) {
    try {
      ops.remove(staged)
    } catch {
      // Leftover scratch next to the target; harmless and replaced next time.
    }
    if (movedAside) {
      try {
        ops.rename(backup, target)
      } catch (rollbackCause) {
        throw new Error(
          `install failed and the previous binary could not be restored; ` +
            `it is still at ${backup} - restore it by hand (rollback error: ${String(rollbackCause)})`,
          { cause },
        )
      }
    }
    throw cause
  }

  if (movedAside) {
    try {
      ops.remove(backup)
    } catch {
      // The old binary may still be running. It is replaced on the next update.
    }
  }

  // The mode was set on the staged file before the rename, which carries it
  // across, so there is nothing to chmod on the live path here.
}
