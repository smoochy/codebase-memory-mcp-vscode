/** Result of a CLI call. The CLI reports failures as JSON with exit code 0. */
export type CliResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; hint?: string }

/** Lines that are not the JSON payload — the CLI logs `level=…` to stdout. */
export function logLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('{'))
}

/**
 * Pull the JSON payload out of CLI output.
 *
 * The binary prefixes its JSON with log lines such as
 * `level=info msg=mem.init budget_mb=32538`, so `JSON.parse(stdout)` fails.
 * We take the last line starting with `{` and parse only that.
 */
export function extractJson<T>(stdout: string): CliResult<T> {
  const candidate = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .pop()

  if (candidate === undefined) {
    return { ok: false, error: 'no JSON object in CLI output' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, error: `failed to parse CLI output: ${detail}` }
  }

  if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
    const record = parsed as { error: unknown; hint?: unknown }
    return {
      ok: false,
      error: String(record.error),
      ...(typeof record.hint === 'string' ? { hint: record.hint } : {}),
    }
  }

  return { ok: true, value: parsed as T }
}

/**
 * The CLI store validator rejects lowercase-drive backslash paths as corrupt,
 * so Windows paths become forward slashes with an uppercase drive letter.
 */
export function normalizeProjectPath(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  return /^[a-z]:/.test(normalized)
    ? normalized[0]!.toUpperCase() + normalized.slice(1)
    : normalized
}
