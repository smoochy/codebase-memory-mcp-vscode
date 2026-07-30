export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** One entry per line, with continuation lines indented so entries stay separable. */
export function formatLine(level: LogLevel, message: string, timestamp: string): string {
  const body = message.replace(/\n/g, '\n    ')
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

/** Strip credentials that could otherwise reach a log the user pastes into an issue. */
export function redactSecrets(message: string): string {
  return message
    .replace(/((?:access_token|token|api_key)=)[^\s&"']+/gi, '$1REDACTED')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1REDACTED')
}
