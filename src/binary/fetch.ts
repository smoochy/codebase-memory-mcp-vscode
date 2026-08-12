import {
  DOWNLOAD_ATTEMPTS,
  MAX_REDIRECTS,
  RETRY_AFTER_CAP_MS,
  RETRY_BACKOFF_MS,
} from '../constants'
import { assertAllowedUrl, expectedChecksum, sha256 } from './verify'

export type FetchLike = (url: string, init: { redirect: 'manual' }) => Promise<Response>

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * How long a `Retry-After` asks us to wait, capped.
 *
 * The header is seconds or an HTTP date. Honouring a rate-limit window in full
 * would leave Setup standing for a minute or more, and three attempts do not
 * outlast a real rate limit anyway, so the server's answer only ever shortens
 * the wait below our own backoff, never lengthens it past the cap.
 */
function retryAfterDelay(response: Response, fallback: number): number {
  const header = response.headers.get('retry-after')
  if (header === null) {
    return fallback
  }
  const seconds = Number(header)
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now()
  if (!Number.isFinite(ms) || ms < 0) {
    return fallback
  }
  return Math.min(ms, RETRY_AFTER_CAP_MS)
}

/**
 * Whether a response is worth asking for again.
 *
 * 3xx is the normal case, not a failure - every request here uses
 * `redirect: 'manual'` and the release lookup exists to read a 302. A 403 is
 * how GitHub answers a secondary rate limit on unauthenticated traffic, but it
 * is also plain "forbidden", so only one carrying `Retry-After` is retried.
 */
function isRetryableResponse(response: Response): boolean {
  if (response.status === 429 || response.status >= 500) {
    return true
  }
  return response.status === 403 && response.headers.get('retry-after') !== null
}

/**
 * Wrap a `FetchLike` so transient failures do not end the run they belong to.
 *
 * github.com refuses individual HTTP/2 streams under load, which arrives as a
 * thrown `fetch failed` and clears on the next attempt. Retrying the throw is
 * the point; the response cases are the same class of transient answer. Every
 * request the extension makes is a GET, so repeating one is free of side
 * effects.
 */
export function withRetry(fetchImpl: FetchLike, sleep = realSleep): FetchLike {
  return async (url, init) => {
    for (let attempt = 0; ; attempt++) {
      // Running past the end of the backoff list is what makes this the last attempt.
      const backoff = RETRY_BACKOFF_MS[attempt]
      try {
        const response = await fetchImpl(url, init)
        if (backoff === undefined || !isRetryableResponse(response)) {
          return response
        }
        const delay = retryAfterDelay(response, backoff)
        // The body is never read on a discarded response, so cancel it rather
        // than leaving the socket open until the collector runs.
        void response.body?.cancel()
        await sleep(delay)
      } catch (cause) {
        if (backoff === undefined) {
          throw cause
        }
        await sleep(backoff)
      }
    }
  }
}

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
  const bytes = await downloadBytes(url, fetchImpl, onProgress)
  const actual = sha256(bytes)

  // Deliberately outside the retry below: re-fetching a body that failed its
  // digest would only ask a corrupt cache, or an attacker, a second time.
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`)
  }

  return bytes
}

/**
 * Fetch a body, restarting the whole request if the stream dies partway.
 *
 * A connection that drops after the headers throws out of the body read, past
 * whatever retry the request itself carries. The redirect chain is walked again
 * from the original URL rather than reusing the resolved one, because the
 * signed asset URL GitHub redirects to is short-lived and may already have
 * expired.
 */
async function downloadBytes(
  url: string,
  fetchImpl: FetchLike,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    const response = await followRedirects(url, fetchImpl)
    try {
      return onProgress === undefined
        ? new Uint8Array(await response.arrayBuffer())
        : await readWithProgress(response, onProgress)
    } catch (cause) {
      if (attempt >= DOWNLOAD_ATTEMPTS) {
        throw cause
      }
      onProgress?.(0)
    }
  }
}
