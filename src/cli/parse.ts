/** Result of a CLI call. The CLI reports failures as JSON with exit code 0. */
export type CliResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; hint?: string; structured?: boolean }

/** Lines that are not the JSON payload — the CLI logs `level=…` to stdout. */
export function logLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('{'))
}

/**
 * The MCP tool-result envelope every `cli <tool>` invocation prints.
 *
 * `structuredContent` carries the payload already parsed; `content[0].text`
 * carries the same thing as a JSON *string*. Preferring the former avoids a
 * second parse, but both are present only on newer binaries, so the text form
 * remains the fallback.
 */
interface McpEnvelope {
  content?: { text?: unknown }[]
  structuredContent?: unknown
  isError?: unknown
}

/**
 * Stringify a value that came out of JSON.parse without ever throwing.
 *
 * `String(value)` looks total but is not: an object whose `toString` and
 * `valueOf` are both non-callable (`{"toString":1,"valueOf":1}` parses to
 * exactly that) makes it throw `Cannot convert object to primitive value`.
 * That throw would escape into the refresh timer, which has no handler, and
 * take the panel down on every tick.
 */
function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  // JSON.stringify cannot throw on a JSON.parse product: no cycles, no BigInt.
  return JSON.stringify(value) ?? 'unknown'
}

/** True for the payload shapes the CLI uses to report a failure. */
function structuredError(payload: unknown): { error: string; hint?: string } | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  const record = payload as { error?: unknown; status?: unknown; hint?: unknown }
  const hint = typeof record.hint === 'string' ? { hint: record.hint } : {}

  // `{"error": "..."}` is the plain form.
  if ('error' in record) {
    return { error: asText(record.error), ...hint }
  }
  // `{"status": "error", "outcome": "exit_nonzero", "hint": "..."}` is what the
  // indexing tools return; there is no `error` key at all, so checking only for
  // that one let real failures through as successes.
  if (record.status === 'error') {
    const outcome = (record as { outcome?: unknown }).outcome
    return {
      error: outcome === undefined ? 'the CLI reported an error' : asText(outcome),
      ...hint,
    }
  }
  return null
}

/**
 * Pull the JSON payload out of CLI output.
 *
 * Two layers have to come off. The binary prefixes its JSON with log lines
 * such as `level=info msg=mem.init budget_mb=32538`, so `JSON.parse(stdout)`
 * fails outright — hence taking the last `{`-line. What that line contains is
 * then an MCP envelope, not the payload: reading `.projects` straight off it
 * always yielded `undefined`, which is why the panel stayed empty and every
 * failure looked like an empty success.
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

  const payload = unwrapEnvelope(parsed)

  if (payload instanceof NonJsonText) {
    const detail = payload.text.trim()
    return {
      ok: false,
      error: detail.length === 0 ? 'the CLI returned no JSON' : detail,
    }
  }

  const failure = structuredError(payload)
  if (failure !== null) {
    return { ok: false, structured: true, ...failure }
  }

  // The envelope's own error flag, for a failure whose payload carries no
  // recognisable error shape of its own.
  if (typeof parsed === 'object' && parsed !== null && (parsed as McpEnvelope).isError === true) {
    return { ok: false, error: 'the CLI reported an error', structured: true }
  }

  return { ok: true, value: payload as T }
}

/** Strip the MCP envelope, or return the value unchanged if there is none. */
function unwrapEnvelope(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null) {
    return parsed
  }
  const envelope = parsed as McpEnvelope

  if (envelope.structuredContent !== undefined) {
    return envelope.structuredContent
  }

  const text = envelope.content?.[0]?.text
  if (typeof text === 'string') {
    try {
      return JSON.parse(text)
    } catch {
      // Every invocation passes --json, so prose is a failure by definition.
      // Returning the text as a payload made it a silent empty success — the
      // exact symptom this whole parser change exists to remove.
      return new NonJsonText(text)
    }
  }

  return parsed
}

/** Marker for envelope text that was not JSON, so it cannot pass as a payload. */
class NonJsonText {
  constructor(readonly text: string) {}
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
