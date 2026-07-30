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
 * Directory name of the active profile, or undefined on the default profile.
 *
 * Global storage lives at `User/globalStorage/<publisher>.<name>` by default and
 * at `User/profiles/<id>/globalStorage/<publisher>.<name>` on a named profile,
 * so the profile identifier can be read straight off the storage path.
 */
export function activeProfileDir(storageDir: string): string | undefined {
  const match = /\/User\/profiles\/([^/]+)\/globalStorage\//.exec(
    storageDir.replace(/\\/g, '/'),
  )
  return match?.[1]
}

export interface McpPathEnv {
  platform: NodeJS.Platform
  home: string
  /** APPDATA on Windows, undefined elsewhere or when unset. */
  appData: string | undefined
  /** Directory name of the active profile, undefined for the default profile. */
  profileDir: string | undefined
}

/**
 * Where the VS Code MCP config may live, most specific first.
 *
 * Named profiles keep their own `mcp.json` under `User/profiles/<id>/`, so
 * checking only the default path would miss the entry for anyone not on the
 * default profile and wrongly report the server as unregistered.
 */
export function mcpConfigCandidates(env: McpPathEnv): string[] {
  const home = env.home.replace(/\\/g, '/').replace(/\/+$/, '')

  let userDir: string
  if (env.platform === 'win32') {
    const roaming = (env.appData ?? `${home}/AppData/Roaming`).replace(/\\/g, '/')
    userDir = `${roaming}/Code/User`
  } else if (env.platform === 'darwin') {
    userDir = `${home}/Library/Application Support/Code/User`
  } else {
    userDir = `${home}/.config/Code/User`
  }

  const candidates: string[] = []
  if (env.profileDir !== undefined && env.profileDir.length > 0) {
    candidates.push(`${userDir}/profiles/${env.profileDir}/mcp.json`)
  }
  candidates.push(`${userDir}/mcp.json`)
  return candidates
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
