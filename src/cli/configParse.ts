/**
 * Shape a config key must have to be accepted.
 *
 * Both parsers read the key as non-whitespace, so `--config-file` would pass
 * and later become the first positional of `config set`. The allowlist built
 * from these keys is meant to stop a webview message choosing an arbitrary
 * argument; requiring a plain identifier is what makes it hold regardless of
 * what the CLI printed.
 */
const KEY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

/**
 * Options a key accepts, read out of the CLI's own description.
 *
 * The CLI has no machine-readable schema, but it does spell the choices out
 * in prose ("Pin graph UI language: en, zh, or auto"). Parsing that is what
 * turns a free-text field into a picker without hardcoding the CLI's keys
 * here, which would go stale the moment upstream adds one.
 */
export function optionsFromDescription(description: string): string[] {
  // A description is a whole line of CLI output, bounded only by the 8 MB
  // stdout cap, and the pattern backtracks over long whitespace runs. Measured
  // at 62 ms for 480 KB, so this is a slow render rather than a hang - but an
  // option list longer than this is not a picker either way.
  if (description.length > 300) {
    return []
  }
  const match = /:\s*([a-z0-9_-]+(?:\s*,\s*[a-z0-9_-]+)*\s*,?\s*or\s+[a-z0-9_-]+)\s*$/i.exec(
    description.trim(),
  )
  if (match === null) {
    return []
  }
  const options = match[1]!
    .replace(/\bor\b/gi, ',')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  // Two is the smallest set worth a picker; one would be a control with no
  // choice in it.
  return new Set(options).size === options.length && options.length >= 2 ? options : []
}

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
 * Only the block below the `Config keys:` header is read - the `Commands:`
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
    if (key === undefined || !KEY_SHAPE.test(key)) {
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
    if (key === undefined || !KEY_SHAPE.test(key)) {
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
