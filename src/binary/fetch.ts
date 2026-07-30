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

/** Download and verify. Bytes are returned only when the digest matches. */
export async function downloadVerified(
  url: string,
  asset: string,
  checksums: string,
  fetchImpl: FetchLike,
): Promise<Uint8Array> {
  // Look up the expected digest first, so a missing entry fails before the download.
  const expected = expectedChecksum(checksums, asset)
  const response = await followRedirects(url, fetchImpl)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = sha256(bytes)

  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`)
  }

  return bytes
}
