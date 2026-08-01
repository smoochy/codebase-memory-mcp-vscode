import { MAX_REDIRECTS } from '../constants'
import { assertAllowedUrl, expectedChecksum, sha256 } from './verify'

export type FetchLike = (url: string, init: { redirect: 'manual' }) => Promise<Response>

/**
 * Follow redirects by hand so every hop is checked against the allowlist.
 * Automatic following would validate only the first URL.
 */
export async function followRedirects(url: string, fetchImpl: FetchLike): Promise<Response> {
  let current = assertAllowedUrl(url).toString()

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(current, { redirect: 'manual' })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null || location.length === 0) {
        throw new Error(`redirect from ${current} is missing location header`)
      }
      // Relative locations are legal, so resolve against the current URL first.
      current = assertAllowedUrl(new URL(location, current).toString()).toString()
      continue
    }

    if (!response.ok) {
      throw new Error(`request for ${current} failed with status ${response.status}`)
    }

    return response
  }

  throw new Error(`too many redirects starting at ${url}`)
}

/** Read the release tag from the `releases/latest` redirect, which needs no API token. */
export async function resolveLatestTag(fetchImpl: FetchLike): Promise<string> {
  const { latestReleaseUrl, tagFromLocation } = await import('./assets.js')
  const url = assertAllowedUrl(latestReleaseUrl()).toString()
  const response = await fetchImpl(url, { redirect: 'manual' })
  const location = response.headers.get('location')
  if (location === null) {
    throw new Error('release lookup returned no location header')
  }
  const tag = tagFromLocation(location)
  if (tag === null) {
    throw new Error(`could not parse release tag from location: ${location}`)
  }
  return tag
}

/**
 * Read the body chunk by chunk, reporting how much has arrived.
 *
 * Falls back to reading it in one piece when the response carries no readable
 * stream or no length to measure against - progress is a nicety, and a missing
 * `content-length` must not fail the download.
 */
async function readWithProgress(
  response: Response,
  onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '')
  const body = response.body
  if (body === null || !Number.isFinite(declared) || declared <= 0) {
    return new Uint8Array(await response.arrayBuffer())
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
    received += value.length
    onProgress(Math.min(1, received / declared))
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** Download and verify. Bytes are returned only when the digest matches. */
export async function downloadVerified(
  url: string,
  asset: string,
  checksums: string,
  fetchImpl: FetchLike,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  // Look up the expected digest first, so a missing entry fails before the download.
  const expected = expectedChecksum(checksums, asset)
  const response = await followRedirects(url, fetchImpl)
  const bytes =
    onProgress === undefined
      ? new Uint8Array(await response.arrayBuffer())
      : await readWithProgress(response, onProgress)
  const actual = sha256(bytes)

  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`)
  }

  return bytes
}
