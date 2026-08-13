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
 * The `User/` directory of the running installation, derived from the
 * extension's own storage directory.
 *
 * Deriving it from the home directory instead names the wrong tree for any
 * instance started with `--user-data-dir`, and reads another installation's
 * files while claiming to describe the running one.
 *
 * `mcp.json` is always the sibling of `globalStorage`, which places it under
 * `User/` on the default profile and under `User/profiles/<id>/` on a named
 * one; the profile segment is stepped over so both cases name the same root.
 */
export function userConfigRoot(storageDir: string): string | null {
  const storage = storageDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const index = storage.lastIndexOf('/globalStorage/')
  if (index === -1) {
    return null
  }
  const profileDir = storage.slice(0, index)
  const named = /^(.*)\/profiles\/[^/]+$/.exec(profileDir)
  return named === null ? profileDir : (named[1] as string)
}

/**
 * Every `mcp.json` of the running installation: the default profile's, plus one
 * per named profile in `profileIds`.
 *
 * The CLI's `install` writes its entry into all of them, so cleaning only the
 * profile this host runs in leaves the rest carrying an absolute path that
 * Settings Sync moves to a machine where it cannot start. Profiles are visited
 * whether or not this extension has ever run in them: the entry there is a side
 * effect of an `install` the user asked for in some other profile, and it is
 * valid on this machine alone.
 *
 * Other installations - Insiders, VSCodium, a second user data directory - stay
 * untouched, being installations this host does not own.
 */
export function mcpConfigCandidates(
  storageDir: string,
  profileIds: readonly string[] = [],
): string[] {
  const root = userConfigRoot(storageDir)
  if (root === null) {
    return []
  }
  return [
    `${root}/mcp.json`,
    ...[...profileIds].sort().map((id) => `${root}/profiles/${id}/mcp.json`),
  ]
}

/**
 * Whether the text names a server of ours at all.
 *
 * Tells a file with nothing to clean from one that holds our entry but could
 * not be parsed, which `withoutMcpEntry` reports the same way. Across a tree of
 * profiles that difference is the only thing separating "nothing to do" from
 * "gave up on six of ten files".
 */
export function mentionsOurServer(text: string | null): boolean {
  return text !== null && MCP_SERVER_KEYS.some((key) => text.includes(`"${key}"`))
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
