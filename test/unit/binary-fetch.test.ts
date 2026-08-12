import * as assert from 'node:assert/strict'
import {
  createLatestTagCache,
  downloadVerified,
  followRedirects,
  withRetry,
  type FetchLike,
} from '../../src/binary/fetch'

/** Build a fetch stub from a map of URL to response. */
function stubFetch(routes: Record<string, Response>, seen: string[] = []): FetchLike {
  return async (url) => {
    seen.push(url)
    const response = routes[url]
    if (response === undefined) {
      throw new Error(`unexpected request: ${url}`)
    }
    return response
  }
}

const redirect = (location: string): Response =>
  new Response(null, { status: 302, headers: { location } })

const ok = (body: BodyInit): Response => new Response(body, { status: 200 })

const A = 'https://github.com/a'
const B = 'https://objects.githubusercontent.com/b'

describe('followRedirects', () => {
  it('returns a direct response unchanged', async () => {
    const response = await followRedirects(A, stubFetch({ [A]: ok('payload') }))
    assert.equal(await response.text(), 'payload')
  })

  it('follows a redirect to another allowed host', async () => {
    const response = await followRedirects(
      A,
      stubFetch({ [A]: redirect(B), [B]: ok('payload') }),
    )
    assert.equal(await response.text(), 'payload')
  })

  it('resolves a relative Location header against the current URL', async () => {
    const seen: string[] = []
    await followRedirects(
      'https://github.com/x/y',
      stubFetch(
        {
          'https://github.com/x/y': redirect('/z'),
          'https://github.com/z': ok('payload'),
        },
        seen,
      ),
    )
    assert.deepEqual(seen, ['https://github.com/x/y', 'https://github.com/z'])
  })

  it('refuses a redirect to a host outside the allowlist', async () => {
    await assert.rejects(
      followRedirects(A, stubFetch({ [A]: redirect('https://evil.example/x') })),
      /host not allowed/i,
    )
  })

  it('refuses a protocol-relative redirect to a host outside the allowlist', async () => {
    await assert.rejects(
      followRedirects(A, stubFetch({ [A]: redirect('//evil.tld/x') })),
      /host not allowed/i,
    )
  })

  it('refuses a redirect that downgrades to http', async () => {
    await assert.rejects(
      followRedirects(A, stubFetch({ [A]: redirect('http://github.com/x') })),
      /https/i,
    )
  })

  it('refuses the initial URL when it is not allowed', async () => {
    await assert.rejects(
      followRedirects('https://evil.example/x', stubFetch({})),
      /host not allowed/i,
    )
  })

  it('stops after too many redirects instead of looping forever', async () => {
    const loop: FetchLike = async () => redirect(A)
    await assert.rejects(followRedirects(A, loop), /too many redirects/i)
  })

  it('rejects a redirect without a Location header', async () => {
    await assert.rejects(
      followRedirects(A, stubFetch({ [A]: new Response(null, { status: 302 }) })),
      /missing location/i,
    )
  })

  it('rejects an error status', async () => {
    await assert.rejects(
      followRedirects(A, stubFetch({ [A]: new Response(null, { status: 404 }) })),
      /404/,
    )
  })
})

describe('withRetry', () => {
  /** Answer with each entry in turn: a thrown value is thrown, a response returned. */
  function scripted(steps: (() => Response | never)[]): { fetch: FetchLike; calls: () => number } {
    let index = 0
    return {
      fetch: async () => {
        // Past the end, the last step repeats - that is how a permanent failure
        // is spelled.
        const step = steps.at(Math.min(index, steps.length - 1))
        index++
        if (step === undefined) {
          throw new Error('scripted fetch has no steps')
        }
        return step()
      },
      calls: () => index,
    }
  }

  const rateLimited = (headers: Record<string, string> = {}): Response =>
    new Response(null, { status: 429, headers })

  it('retries a thrown transport failure and returns the eventual response', async () => {
    const waits: number[] = []
    const script = scripted([
      () => {
        throw new TypeError('fetch failed')
      },
      () => ok('payload'),
    ])
    const response = await withRetry(script.fetch, async (ms) => {
      waits.push(ms)
    })(A, { redirect: 'manual' })

    assert.equal(await response.text(), 'payload')
    assert.equal(script.calls(), 2)
    assert.deepEqual(waits, [250])
  })

  it('gives up after the stated bound and throws the last cause', async () => {
    const waits: number[] = []
    const script = scripted([
      () => {
        throw new TypeError('fetch failed')
      },
    ])
    await assert.rejects(
      withRetry(script.fetch, async (ms) => {
        waits.push(ms)
      })(A, { redirect: 'manual' }),
      /fetch failed/,
    )
    // Three attempts, and the backoff is spent between them rather than after
    // the last one.
    assert.equal(script.calls(), 3)
    assert.deepEqual(waits, [250, 1000])
  })

  it('retries a 500 and a 429', async () => {
    for (const status of [500, 429]) {
      const script = scripted([() => new Response(null, { status }), () => ok('payload')])
      const response = await withRetry(script.fetch, async () => {})(A, { redirect: 'manual' })
      assert.equal(response.status, 200)
      assert.equal(script.calls(), 2)
    }
  })

  it('returns a 404 and a 302 untouched', async () => {
    // 3xx is the normal answer here, not a failure: every request is manual-redirect
    // and the release lookup exists to read the Location header off a 302.
    for (const status of [404, 302, 403]) {
      const script = scripted([() => new Response(null, { status })])
      const response = await withRetry(script.fetch, async () => {})(A, { redirect: 'manual' })
      assert.equal(response.status, status)
      assert.equal(script.calls(), 1)
    }
  })

  it('retries a 403 that carries Retry-After, which is how a secondary rate limit arrives', async () => {
    const script = scripted([
      () => new Response(null, { status: 403, headers: { 'retry-after': '1' } }),
      () => ok('payload'),
    ])
    const response = await withRetry(script.fetch, async () => {})(A, { redirect: 'manual' })
    assert.equal(response.status, 200)
    assert.equal(script.calls(), 2)
  })

  it('caps Retry-After at the backoff rather than standing for the full window', async () => {
    const waits: number[] = []
    const script = scripted([() => rateLimited({ 'retry-after': '60' }), () => ok('payload')])
    await withRetry(script.fetch, async (ms) => {
      waits.push(ms)
    })(A, { redirect: 'manual' })
    assert.deepEqual(waits, [1000])
  })

  it('honours a Retry-After shorter than the backoff', async () => {
    const waits: number[] = []
    const script = scripted([() => rateLimited({ 'retry-after': '0.1' }), () => ok('payload')])
    await withRetry(script.fetch, async (ms) => {
      waits.push(ms)
    })(A, { redirect: 'manual' })
    assert.deepEqual(waits, [100])
  })

  it('falls back to the backoff when Retry-After cannot be read', async () => {
    const waits: number[] = []
    const script = scripted([() => rateLimited({ 'retry-after': 'soon' }), () => ok('payload')])
    await withRetry(script.fetch, async (ms) => {
      waits.push(ms)
    })(A, { redirect: 'manual' })
    assert.deepEqual(waits, [250])
  })

  it('cancels the body of a response it discards', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'))
      },
      cancel() {
        cancelled = true
      },
    })
    const script = scripted([
      () => new Response(stream, { status: 503 }),
      () => ok('payload'),
    ])
    await withRetry(script.fetch, async () => {})(A, { redirect: 'manual' })
    assert.equal(cancelled, true)
  })
})

describe('downloadVerified', () => {
  const CHECKSUMS =
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  asset.tar.gz'

  it('returns the bytes when the digest matches', async () => {
    const bytes = await downloadVerified(
      A,
      'asset.tar.gz',
      CHECKSUMS,
      stubFetch({ [A]: ok('abc') }),
    )
    assert.equal(new TextDecoder().decode(bytes), 'abc')
  })

  it('rejects when the digest differs', async () => {
    await assert.rejects(
      downloadVerified(A, 'asset.tar.gz', CHECKSUMS, stubFetch({ [A]: ok('tampered') })),
      /checksum mismatch/i,
    )
  })

  it('rejects when the asset has no published checksum', async () => {
    await assert.rejects(
      downloadVerified(A, 'other.tar.gz', CHECKSUMS, stubFetch({ [A]: ok('abc') })),
      /no checksum/i,
    )
  })

  it('reports progress against the declared length while the body arrives', async () => {
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('a'))
        controller.enqueue(encoder.encode('bc'))
        controller.close()
      },
    })
    const seen: number[] = []
    const bytes = await downloadVerified(
      A,
      'asset.tar.gz',
      CHECKSUMS,
      stubFetch({
        [A]: new Response(chunked, { status: 200, headers: { 'content-length': '3' } }),
      }),
      (fraction) => seen.push(fraction),
    )
    // Still the verified bytes, and the digest was taken over the reassembled
    // stream rather than over one chunk.
    assert.equal(new TextDecoder().decode(bytes), 'abc')
    assert.deepEqual(seen, [1 / 3, 1])
  })

  it('restarts the download when the stream dies after the headers', async () => {
    const dying = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('a'))
            controller.error(new Error('stream closed'))
          },
        }),
        { status: 200, headers: { 'content-length': '3' } },
      )
    const seen: number[] = []
    const requested: string[] = []
    let attempt = 0
    const fetchImpl: FetchLike = async (url) => {
      requested.push(url)
      attempt++
      return attempt === 1 ? dying() : ok('abc')
    }

    const bytes = await downloadVerified(A, 'asset.tar.gz', CHECKSUMS, fetchImpl, (fraction) =>
      seen.push(fraction),
    )

    assert.equal(new TextDecoder().decode(bytes), 'abc')
    // The chain is walked again from the original URL, because the signed asset
    // URL it resolves to is short-lived.
    assert.deepEqual(requested, [A, A])
    // Progress falls back to zero rather than resuming where the dead stream
    // stopped. Nothing is reported before that: erroring a stream discards
    // whatever was still queued on it, so the chunk never reaches the reader.
    assert.deepEqual(seen, [0])
  })

  it('gives up after the second attempt at the body', async () => {
    let attempt = 0
    const fetchImpl: FetchLike = async () => {
      attempt++
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error('stream closed'))
          },
        }),
        { status: 200, headers: { 'content-length': '3' } },
      )
    }
    await assert.rejects(
      downloadVerified(A, 'asset.tar.gz', CHECKSUMS, fetchImpl, () => {}),
      /stream closed/,
    )
    assert.equal(attempt, 2)
  })

  it('does not re-fetch a body that failed its checksum', async () => {
    let attempt = 0
    const fetchImpl: FetchLike = async () => {
      attempt++
      return ok('tampered')
    }
    await assert.rejects(
      downloadVerified(A, 'asset.tar.gz', CHECKSUMS, fetchImpl),
      /checksum mismatch/i,
    )
    assert.equal(attempt, 1)
  })

  it('downloads without progress when the response declares no length', async () => {
    const seen: number[] = []
    const bytes = await downloadVerified(
      A,
      'asset.tar.gz',
      CHECKSUMS,
      stubFetch({ [A]: ok('abc') }),
      (fraction) => seen.push(fraction),
    )
    assert.equal(new TextDecoder().decode(bytes), 'abc')
    assert.deepEqual(seen, [])
  })
})

describe('createLatestTagCache', () => {
  /** Answers every release lookup with `tag`, counting how often it was asked. */
  const tagFetch = (tags: string[], calls: { n: number }): FetchLike =>
    async () => {
      const tag = tags[Math.min(calls.n, tags.length - 1)] ?? 'v1.0.0'
      calls.n += 1
      return new Response(null, {
        status: 302,
        headers: { location: `https://github.com/o/r/releases/tag/${tag}` },
      })
    }

  it('holds the answer until the TTL expires, then looks it up again', async () => {
    const calls = { n: 0 }
    let now = 1_000
    const cache = createLatestTagCache(tagFetch(['v1.0.0', 'v1.1.0'], calls), 60_000, () => now)

    assert.equal(await cache.get(), 'v1.0.0')
    now += 59_000
    assert.equal(await cache.get(), 'v1.0.0')
    assert.equal(calls.n, 1, 'a fresh answer must not go back to the network')

    now += 2_000
    assert.equal(await cache.get(), 'v1.1.0', 'a stale answer must be looked up again')
    assert.equal(calls.n, 2)
  })

  it('keeps the last answer when a lookup fails', async () => {
    const calls = { n: 0 }
    let now = 0
    const cache = createLatestTagCache(
      async (url, init) => {
        if (calls.n > 0) {
          calls.n += 1
          throw new Error('offline')
        }
        return tagFetch(['v1.0.0'], calls)(url, init)
      },
      10,
      () => now,
    )

    assert.equal(await cache.get(), 'v1.0.0')
    now += 100
    await assert.rejects(cache.get(), /offline/)
    now += 100
    await assert.rejects(cache.get(), /offline/)
  })

  it('takes a tag resolved elsewhere as the current answer', async () => {
    const calls = { n: 0 }
    let now = 0
    const cache = createLatestTagCache(tagFetch(['v1.0.0'], calls), 60_000, () => now)

    cache.set('v2.0.0')
    now += 59_000
    assert.equal(await cache.get(), 'v2.0.0')
    assert.equal(calls.n, 0, 'an update just installed must not be offered again')
  })
})
