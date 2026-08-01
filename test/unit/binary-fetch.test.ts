import * as assert from 'node:assert/strict'
import { downloadVerified, followRedirects, type FetchLike } from '../../src/binary/fetch'

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
