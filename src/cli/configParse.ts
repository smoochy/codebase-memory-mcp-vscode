export interface CliSetting {
  key: string
  value: string
  default: string
  description: string
}

interface KeyInfo {
  default: string
  description: string
}

/**
 * Parse `codebase-memory-mcp config` (no argument).
 *
 * Only the block below the `Config keys:` header is read — the `Commands:`
 * block above it looks similar enough to match a naive pattern.
 */
export function parseConfigKeys(stdout: string): Map<string, KeyInfo> {
  const result = new Map<string, KeyInfo>()
  const lines = stdout.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === 'Config keys:')
  if (start === -1) {
    return result
  }

  for (const line of lines.slice(start + 1)) {
    const match = /^\s+(\S+)\s+default=(\S*)\s+(.*)$/.exec(line)
    if (!match) {
      continue
    }
    const [, key, defaultValue, description] = match
    if (key === undefined) {
      continue
    }
    result.set(key, {
      default: defaultValue ?? '',
      description: (description ?? '').trim(),
    })
  }
  return result
}

/** Parse `codebase-memory-mcp config list` into key/value pairs. */
export function parseConfigList(stdout: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+=\s*(.*?)\s*$/.exec(line)
    if (!match) {
      continue
    }
    const [, key, value] = match
    if (key === undefined) {
      continue
    }
    result.set(key, value ?? '')
  }
  return result
}

/**
 * Combine both sources. Keys known only to `config list` are kept so that new
 * upstream settings appear without an extension update.
 */
export function mergeSettings(
  keys: Map<string, KeyInfo>,
  values: Map<string, string>,
): CliSetting[] {
  const allKeys = new Set([...keys.keys(), ...values.keys()])
  return [...allKeys].sort().map((key) => {
    const info = keys.get(key)
    return {
      key,
      value: values.get(key) ?? info?.default ?? '',
      default: info?.default ?? '',
      description: info?.description ?? '',
    }
  })
}
