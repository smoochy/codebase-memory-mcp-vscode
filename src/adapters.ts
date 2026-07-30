import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import type { FileOps } from './binary/install'
import type { InstallFileOps } from './binary/manager'
import type { RunOutput, Runner } from './cli/client'

/** Real filesystem behind the pure install logic. */
export const fileOps: FileOps = {
  exists: (p) => existsSync(p),
  rename: (from, to) => renameSync(from, to),
  write: (p, data) => writeFileSync(p, data),
  remove: (p) => rmSync(p, { force: true }),
  chmod: (p, mode) => chmodSync(p, mode),
  mkdirp: (p) => mkdirSync(p, { recursive: true }),
}

/** Real filesystem behind the pure download/install orchestration. */
export const installOps: InstallFileOps = {
  ...fileOps,
  listDir: (dir) => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  },
  read: (p) => readFileSync(p),
  removeDir: (p) => rmSync(p, { force: true, recursive: true }),
}

/** Read a file, returning null when it cannot be read. */
export function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * How much of a stream is kept. A child that writes without bound would
 * otherwise grow the extension host's heap until it dies. Truncating only ever
 * happens in that runaway case, where the output is unusable anyway.
 */
export const MAX_CAPTURED_OUTPUT = 8 * 1024 * 1024

/**
 * Spawn without a shell, so no argument can be reinterpreted as shell syntax.
 * The child is killed on timeout rather than left hanging.
 */
export const runProcess: Runner = (command, args, timeoutMs) =>
  new Promise<RunOutput>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      child.kill()
      if (!settled) {
        settled = true
        reject(new Error(`command timed out after ${timeoutMs} ms: ${command}`))
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURED_OUTPUT) {
        stdout += chunk.toString('utf8')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURED_OUTPUT) {
        stderr += chunk.toString('utf8')
      }
    })
    child.on('error', (cause) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(cause)
      }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        resolve({ stdout, stderr, code })
      }
    })
  })
