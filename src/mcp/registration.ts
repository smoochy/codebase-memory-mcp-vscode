import { MCP_SERVER_KEYS } from '../constants'

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
 * The config text without this extension's MCP entry, or `null` when it holds
 * no such entry and there is therefore nothing to write back.
 *
 * VS Code gets its server from a definition provider, so an entry on disk is
 * only ever a second, absolute-path copy of the same server - and `mcp.json` is
 * carried between machines by Settings Sync, where an absolute path from
 * another operating system cannot start. The CLI's own `install` still writes
 * one, having detected VS Code as an agent, so this is what takes it back out.
 *
 * Only our own keys go. Everything else in the file is kept, including any
 * other server the user registered by hand. Comments do not survive the round
 * trip - VS Code rewrites this file itself, and a JSONC editor would cost a
 * dependency this extension does not have.
 *
 * Unparsable input yields `null` rather than a rewrite: a file we cannot read
 * is one we must not flatten.
 */
export function withoutMcpEntry(text: string | null): string | null {
  if (text === null || text.trim().length === 0) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(text))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const root = { ...(parsed as Record<string, unknown>) }
  let removed = false

  for (const container of ['servers', 'mcpServers']) {
    const existing = root[container]
    if (typeof existing !== 'object' || existing === null) {
      continue
    }
    const servers = { ...(existing as Record<string, unknown>) }
    for (const key of MCP_SERVER_KEYS) {
      if (key in servers) {
        delete servers[key]
        removed = true
      }
    }
    root[container] = servers
  }

  return removed ? `${JSON.stringify(root, null, 4)}\n` : null
}
