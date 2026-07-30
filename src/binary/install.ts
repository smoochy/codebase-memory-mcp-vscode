export interface FileOps {
  exists(p: string): boolean
  rename(from: string, to: string): void
  write(p: string, data: Uint8Array): void
  remove(p: string): void
  chmod(p: string, mode: number): void
  mkdirp(p: string): void
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
): { command: string; args: string[] } {
  if (archive.endsWith('.tar.gz')) {
    return { command: 'tar', args: ['-xzf', archive, '-C', targetDir] }
  }
  if (archive.endsWith('.zip')) {
    return { command: 'tar', args: ['-xf', archive, '-C', targetDir] }
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
    ops.rename(target, backup)
    movedAside = true
  }

  try {
    ops.write(target, data)
  } catch (cause) {
    if (movedAside) {
      ops.rename(backup, target)
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

  if (platform !== 'win32') {
    ops.chmod(target, 0o755)
  }
}
