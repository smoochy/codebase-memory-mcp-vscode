import { createHash } from 'node:crypto'
import { ALLOWED_HOSTS } from '../constants'

/**
 * Validate a URL before any request goes out.
 *
 * The host must match an allowed entry exactly. A suffix test would let
 * `evil-github.com` and `github.com.evil.tld` through, so it is not used.
 */
export function assertAllowedUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`invalid URL: ${url}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`refusing non-https URL: ${url}`)
  }

  const host = parsed.hostname.toLowerCase()
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new Error(`host not allowed: ${host}`)
  }

  return parsed
}

/** Parse `checksums.txt`, one `<sha256>  <filename>` pair per line. */
export function parseChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+(\S+)$/i.exec(line.trim())
    if (match === null) {
      continue
    }
    const hash = match[1]
    const name = match[2]
    if (hash === undefined || name === undefined) {
      continue
    }
    result.set(name, hash.toLowerCase())
  }
  return result
}

/** Look up the expected hash. A missing entry is an error, never a skip. */
export function expectedChecksum(text: string, asset: string): string {
  const hash = parseChecksums(text).get(asset)
  if (hash === undefined) {
    throw new Error(`no checksum published for ${asset}`)
  }
  return hash
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
