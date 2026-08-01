import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formatLine, shouldRotate, type LogLevel } from './logging'

/** Cap per file and how many old files are kept, per the spec: 1 MB times 3. */
export const MAX_LOG_BYTES = 1024 * 1024
export const KEPT_FILES = 3

/**
 * Append-only log file with rotation.
 *
 * The output channel alone was not enough: it lives only in memory, so nothing
 * survives a window reload, and "open the log" could only ever reveal a panel
 * rather than a file the user can read, search, or attach to a bug report.
 *
 * Every write is synchronous. The volume is a handful of lines per refresh, and
 * an async queue would risk losing the tail of the log exactly when it matters,
 * during a crash.
 */
export class LogFile {
  readonly path: string

  constructor(
    private readonly directory: string,
    fileName = 'better-cmm.log',
    private readonly maxBytes: number = MAX_LOG_BYTES,
    private readonly keep: number = KEPT_FILES,
  ) {
    this.path = join(directory, fileName)
  }

  /** Append one entry, rotating first when this write would pass the cap. */
  append(level: LogLevel, message: string, timestamp: string): void {
    const line = formatLine(level, message, timestamp) + '\n'
    try {
      mkdirSync(this.directory, { recursive: true })
      if (shouldRotate(this.size(), Buffer.byteLength(line), this.maxBytes)) {
        this.rotate()
      }
      appendFileSync(this.path, line, 'utf8')
    } catch {
      // Logging must never be the reason something fails. The output channel
      // still carries the same line.
    }
  }

  private size(): number {
    try {
      return statSync(this.path).size
    } catch {
      return 0
    }
  }

  /**
   * Shift `.1` to `.2` and so on, dropping the oldest, then move the live file
   * to `.1`. Walking downwards would overwrite a file before it was copied.
   */
  private rotate(): void {
    const oldest = `${this.path}.${String(this.keep)}`
    try {
      rmSync(oldest, { force: true })
    } catch {
      // An undeletable oldest file must not stop the rotation.
    }
    for (let index = this.keep - 1; index >= 1; index -= 1) {
      try {
        renameSync(`${this.path}.${String(index)}`, `${this.path}.${String(index + 1)}`)
      } catch {
        // Absent generation, nothing to move.
      }
    }
    try {
      renameSync(this.path, `${this.path}.1`)
    } catch {
      // Nothing written yet.
    }
  }
}
