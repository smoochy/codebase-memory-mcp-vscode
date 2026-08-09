import { MCP_SERVER_KEYS } from '../constants'
import type { RegistrationStatus } from '../state/machine'

/**
 * Remove comments so `JSON.parse` accepts a VS Code config file.
 * A small scanner is used because a regular expression cannot tell a comment
 * from the same characters inside a string literal.
 */
export function stripJsonComments(text: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++
      }
      i--
      continue
    }

    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 1
      continue
    }

    result += char
  }

  return result
}

function commandOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const command = (value as { command?: unknown }).command
  return typeof command === 'string' && command.length > 0 ? command : null
}

/**
 * What a config file that is not there reads as.
 *
 * `null` means "could not be read", which is deliberately not an answer. A file
 * that does not exist is an answer - nothing is registered - and conflating the
 * two leaves a fresh installation claiming a registration it does not have.
 */
export const NO_CONFIG_FILE = '{}'

/**
 * Interpret the MCP config text.
 *
 * Unreadable or unparsable input yields `unknown`, never `missing`: we must not
 * push the user towards a reinstall on the strength of a file we could not read.
 */
export function readRegistration(text: string | null): RegistrationStatus {
  if (text === null) {
    return { kind: 'unknown' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(text))
  } catch {
    return { kind: 'unknown' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'unknown' }
  }

  const root = parsed as Record<string, unknown>
  for (const container of [root['servers'], root['mcpServers']]) {
    if (typeof container !== 'object' || container === null) {
      continue
    }
    const servers = container as Record<string, unknown>
    for (const key of MCP_SERVER_KEYS) {
      const command = commandOf(servers[key])
      if (command !== null) {
        return { kind: 'present', path: command }
      }
    }
  }

  return { kind: 'missing' }
}

/**
 * Where the VS Code MCP config lives, derived from the extension's own storage
 * directory.
 *
 * Deriving it from the home directory instead names the wrong file for any
 * instance started with `--user-data-dir`, and reads the real profile's
 * registration while claiming to describe the running one.
 *
 * `mcp.json` is always the sibling of `globalStorage`, which places it under
 * `User/` on the default profile and under `User/profiles/<id>/` on a named one
 * without either case being spelled out here.
 */
export function mcpConfigCandidates(storageDir: string): string[] {
  const storage = storageDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const marker = '/globalStorage/'
  const index = storage.lastIndexOf(marker)
  return index === -1 ? [] : [`${storage.slice(0, index)}/mcp.json`]
}

/**
 * Interpret the candidate files in order.
 *
 * A present entry wins. Otherwise `missing` is only reported if at least one
 * file was readable, so an unreadable set of files stays `unknown`.
 */
export function firstRegistration(texts: Array<string | null>): RegistrationStatus {
  let sawReadable = false

  for (const text of texts) {
    const status = readRegistration(text)
    if (status.kind === 'present') {
      return status
    }
    if (status.kind === 'missing') {
      sawReadable = true
    }
  }

  return sawReadable ? { kind: 'missing' } : { kind: 'unknown' }
}
