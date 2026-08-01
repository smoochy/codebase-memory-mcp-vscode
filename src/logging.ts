export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Longest single entry kept. Captured process output can reach megabytes. */
export const MAX_LOG_ENTRY_CHARS = 8 * 1024

/** Keep the head of an oversized entry, and say plainly that it was cut. */
export function truncateForLog(message: string): string {
  if (message.length <= MAX_LOG_ENTRY_CHARS) {
    return message
  }
  const dropped = message.length - MAX_LOG_ENTRY_CHARS
  return `${message.slice(0, MAX_LOG_ENTRY_CHARS)}… [${String(dropped)} more characters omitted]`
}

/**
 * One entry per line, with continuation lines indented so entries stay separable.
 *
 * A lone carriage return counts too: an editor treats it as a line break, so
 * indenting only `\n` let untrusted process output start at column zero and
 * impersonate a real entry in a log someone reads as evidence.
 */
export function formatLine(level: LogLevel, message: string, timestamp: string): string {
  const body = message.replace(/\r\n?|\n/g, '\n    ')
  return `${timestamp} [${level.toUpperCase()}] ${body}`
}

/**
 * Rotate when the next write would push the file past the cap. An empty file is
 * never rotated, otherwise an oversized single entry would rotate forever.
 */
export function shouldRotate(
  currentBytes: number,
  incomingBytes: number,
  maxBytes: number,
): boolean {
  return currentBytes > 0 && currentBytes + incomingBytes > maxBytes
}

const SECRET_KEY =
  /(?:access_token|token|api_key|authorization|password|passwd|secret|credential|private_key)/i

/**
 * Scans for `<key><sep><value>` occurrences (query-string `=` or JSON `:`) where the key
 * name contains a secret keyword, and replaces the value with REDACTED in place.
 *
 * The `=` form (query string / env var) matches up to the next `&`, quote, or whitespace -
 * same behaviour as before. The `:` form (JSON) only redacts when the value is a proper
 * double-quoted JSON string, walked char-by-char honouring `\"` escapes so the real closing
 * quote is never mistaken for content. Any other JSON value shape (array, object, number,
 * bare word) is left completely untouched - under-redacting a non-string is fine, corrupting
 * the line while leaking part of the value is not.
 */
function redactKeyedValues(message: string): string {
  let out = ''
  let i = 0
  const keyRe = new RegExp(SECRET_KEY.source + '"?\\s*([=:])\\s*', 'gi')

  while (i < message.length) {
    keyRe.lastIndex = i
    const match = keyRe.exec(message)
    if (!match) {
      out += message.slice(i)
      break
    }

    const sep = match[1]
    const valueStart = match.index + match[0].length
    out += message.slice(i, match.index) + match[0]

    if (sep === '=') {
      const rest = message.slice(valueStart)
      const valueMatch = /^[^\s&"']+/.exec(rest)
      if (valueMatch) {
        out += 'REDACTED'
        i = valueStart + valueMatch[0].length
      } else {
        i = valueStart
      }
      continue
    }

    // JSON form: only redact a properly quoted string value.
    if (message[valueStart] === '"') {
      let j = valueStart + 1
      while (j < message.length && message[j] !== '"') {
        if (message[j] === '\\') j++ // skip escaped char, including \"
        j++
      }
      if (j < message.length) {
        // j is the index of the closing quote.
        const isAuthKey = /authorization/i.test(match[0])
        const inner = message.slice(valueStart + 1, j)
        if (isAuthKey) {
          // Keep the scheme word visible, same as the header form.
          const schemeMatch = /^([A-Za-z]+\s+)/.exec(inner)
          out += schemeMatch ? `"${schemeMatch[1]}REDACTED` : '"REDACTED'
        } else {
          out += '"REDACTED'
        }
        i = j
        continue
      }
    }

    // Not a quoted string (array/object/number/bool/null/unterminated) - leave untouched.
    i = valueStart
  }

  return out
}

/** Strip credentials that could otherwise reach a log the user pastes into an issue. */
export function redactSecrets(message: string): string {
  return redactKeyedValues(message)
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1REDACTED')
    // Any Authorization scheme other than Bearer (already handled above). Stops at a
    // double quote too, so a header line embedded as prose inside a JSON string value
    // doesn't consume the string's closing quote (and whatever follows it).
    .replace(/(Authorization:\s*(?!Bearer\s)[^\s"]+\s+)[^\s"]+/gi, '$1REDACTED')
}
