import * as assert from 'node:assert/strict'
import { assetName, downloadUrl, checksumsUrl } from '../../src/binary/assets'
import {
  installLatest,
  installRelease,
  refusesManagedInstall,
  type InstallDeps,
  type InstallFileOps,
} from '../../src/binary/manager'
import { sha256 } from '../../src/binary/verify'
import type { RunOutput } from '../../src/cli/client'
import type { FetchLike } from '../../src/binary/fetch'
import { computeState, type ExtensionState } from '../../src/state/machine'
import type { WizardStepId } from '../../src/setup/wizard'

const PLATFORM: NodeJS.Platform = 'linux'
const ARCH = 'x64'
const TAG = 'v1.2.3'
const STORAGE = '/storage'
const ASSET = assetName({ platform: PLATFORM, arch: ARCH })
const ARCHIVE_BYTES = new TextEncoder().encode('fake-archive-contents')
const GOOD_CHECKSUMS = `${sha256(ARCHIVE_BYTES)}  ${ASSET}`

/** In-memory filesystem recording every operation, mirroring binary-install.test.ts's style. */
function memoryOps(): InstallFileOps & { files: Map<string, Uint8Array>; log: string[] } {
  const files = new Map<string, Uint8Array>()
  const log: string[] = []
  return {
    files,
    log,
    exists: (p) => files.has(p),
    rename(from, to) {
      log.push(`rename ${from} ${to}`)
      const data = files.get(from)
      if (data === undefined) {
        throw new Error(`ENOENT ${from}`)
      }
      files.delete(from)
      files.set(to, data)
    },
    write(p, data) {
      log.push(`write ${p}`)
      files.set(p, data)
    },
    remove(p) {
      log.push(`remove ${p}`)
      files.delete(p)
    },
    chmod(p, mode) {
      log.push(`chmod ${p} ${mode.toString(8)}`)
    },
    mkdirp(p) {
      log.push(`mkdirp ${p}`)
    },
    listDir() {
      return []
    },
    read(p) {
      const data = files.get(p)
      if (data === undefined) {
        throw new Error(`ENOENT ${p}`)
      }
      return data
    },
    removeDir(p) {
      log.push(`removeDir ${p}`)
      for (const key of [...files.keys()]) {
        if (key === p || key.startsWith(`${p}/`)) {
          files.delete(key)
        }
      }
    },
  }
}

function stubFetch(routes: Record<string, Response>): FetchLike {
  return async (url) => {
    const response = routes[url]
    if (response === undefined) {
      throw new Error(`unexpected request: ${url}`)
    }
    return response
  }
}

/**
 * A run() stub that simulates `tar` by writing the extracted binary itself,
 * and answers the post-install `daemon stop` the way a real binary does.
 */
function extractingRun(ops: InstallFileOps, calls: string[][]): InstallDeps['run'] {
  return (command, args) => {
    calls.push([command, ...args])
    if (args[0] === 'daemon') {
      return Promise.resolve({
        stdout: 'daemon: not running (nothing to stop)',
        stderr: '',
        code: 0,
      } satisfies RunOutput)
    }
    const targetDir = args[args.length - 1]
    if (targetDir === undefined) {
      throw new Error('no target dir in args')
    }
    ops.write(`${targetDir}/codebase-memory-mcp`, new Uint8Array([9, 9, 9]))
    return Promise.resolve({ stdout: '', stderr: '', code: 0 } satisfies RunOutput)
  }
}

function baseDeps(overrides: Partial<InstallDeps> = {}): InstallDeps {
  // The default extractor must write into whichever ops the caller ended up
  // with, so resolve the override before building it.
  const ops = overrides.ops ?? memoryOps()
  const runCalls: string[][] = []
  return {
    fetchImpl: stubFetch({
      [checksumsUrl(TAG)]: new Response(GOOD_CHECKSUMS, { status: 200 }),
      [downloadUrl(TAG, ASSET)]: new Response(ARCHIVE_BYTES, { status: 200 }),
    }),
    platform: PLATFORM,
    arch: ARCH,
    storageDir: STORAGE,
    // The install target is now explicit: the CLI registers this exact path
    // as its MCP command, so it is not derived from the storage directory.
    installPath: `${STORAGE}/bin/codebase-memory-mcp`,
    ...overrides,
    ops,
    run: overrides.run ?? extractingRun(ops, runCalls),
  }
}

describe('installRelease', () => {
  it('installs the verified binary to the managed path', async () => {
    const deps = baseDeps()
    const { path: target, daemonStopError } = await installRelease(TAG, deps)

    assert.equal(target, '/storage/bin/codebase-memory-mcp')
    assert.equal(daemonStopError, undefined)
    const ops = deps.ops as ReturnType<typeof memoryOps>
    assert.ok(ops.files.has(target), 'the managed binary must exist')
    assert.deepEqual([...ops.files.get(target) ?? []], [9, 9, 9])
  })

  // From CLI 0.10.0 a daemon started by the replaced binary survives the
  // update and refuses every client of the new build, so the install is not
  // finished until it is retired. Measured against real 0.10.2 and 0.10.3
  // binaries: the conflict is an exit 1 on the next call, and stopping across
  // versions works.
  describe('the surviving daemon', () => {
    /** Every run() call, so the daemon stop can be found and ordered. */
    function tracked(): { deps: InstallDeps; calls: string[][] } {
      const ops = memoryOps()
      const calls: string[][] = []
      return { deps: baseDeps({ ops, run: extractingRun(ops, calls) }), calls }
    }

    it('stops it with the newly installed binary, after the binary is in place', async () => {
      const { deps, calls } = tracked()
      await installRelease(TAG, deps)

      const stop = calls.find((call) => call[1] === 'daemon')
      assert.deepEqual(stop, ['/storage/bin/codebase-memory-mcp', 'daemon', 'stop'])
      // After extraction, so the binary it runs is the one just installed.
      assert.ok(
        calls.indexOf(stop) > calls.findIndex((call) => call[1] === '-xzf'),
        'the stop must come after the archive is extracted',
      )
    })

    // A binary in place with a daemon that would not die is worse than a
    // failed install: every call fails and nothing says why.
    it('reports a stop that exits non-zero without failing the install', async () => {
      const ops = memoryOps()
      const calls: string[][] = []
      const extract = extractingRun(ops, calls)
      const deps = baseDeps({
        ops,
        run: (command, args, timeout) =>
          args[0] === 'daemon'
            ? Promise.resolve({ stdout: '', stderr: 'refused', code: 1 } satisfies RunOutput)
            : extract(command, args, timeout),
      })

      const result = await installRelease(TAG, deps)
      assert.equal(result.path, '/storage/bin/codebase-memory-mcp')
      assert.equal(result.daemonStopError, 'refused')
      assert.ok(ops.files.has(result.path), 'the install itself must still have happened')
    })

    it('reports a stop that could not be spawned at all', async () => {
      const ops = memoryOps()
      const calls: string[][] = []
      const extract = extractingRun(ops, calls)
      const deps = baseDeps({
        ops,
        run: (command, args, timeout) =>
          args[0] === 'daemon'
            ? Promise.reject(new Error('spawn ENOENT'))
            : extract(command, args, timeout),
      })

      const result = await installRelease(TAG, deps)
      assert.equal(result.daemonStopError, 'spawn ENOENT')
    })

    // 0.9.x has no `daemon` subcommand, so it answers on stdout with a usage
    // message and no stderr. The message still has to name something.
    it('falls back to stdout when a stop failed without saying so on stderr', async () => {
      const ops = memoryOps()
      const calls: string[][] = []
      const extract = extractingRun(ops, calls)
      const deps = baseDeps({
        ops,
        run: (command, args, timeout) =>
          args[0] === 'daemon'
            ? Promise.resolve({ stdout: 'unknown command', stderr: '', code: 2 } satisfies RunOutput)
            : extract(command, args, timeout),
      })

      assert.equal((await installRelease(TAG, deps)).daemonStopError, 'unknown command')
    })

    it('reports the exit code when a failed stop said nothing at all', async () => {
      const ops = memoryOps()
      const calls: string[][] = []
      const extract = extractingRun(ops, calls)
      const deps = baseDeps({
        ops,
        run: (command, args, timeout) =>
          args[0] === 'daemon'
            ? Promise.resolve({ stdout: '', stderr: '', code: 3 } satisfies RunOutput)
            : extract(command, args, timeout),
      })

      assert.equal((await installRelease(TAG, deps)).daemonStopError, 'exited with 3')
    })
  })

  it('cleans up the temp archive and extraction directory on success', async () => {
    const deps = baseDeps()
    await installRelease(TAG, deps)

    const ops = deps.ops as ReturnType<typeof memoryOps>
    assert.ok(!ops.files.has(`/storage/download/${ASSET}`), 'archive must be removed')
    assert.ok(
      ![...ops.files.keys()].some((k) => k.startsWith('/storage/download/unpacked')),
      'extraction dir must be removed',
    )
  })

  it('never writes the archive or the managed binary when the checksum mismatches', async () => {
    const deps = baseDeps({
      fetchImpl: stubFetch({
        [checksumsUrl(TAG)]: new Response(GOOD_CHECKSUMS, { status: 200 }),
        // Tampered payload: sha256 no longer matches GOOD_CHECKSUMS.
        [downloadUrl(TAG, ASSET)]: new Response('tampered bytes', { status: 200 }),
      }),
    })

    await assert.rejects(installRelease(TAG, deps), /checksum mismatch/i)

    const ops = deps.ops as ReturnType<typeof memoryOps>
    assert.equal(ops.files.size, 0, 'nothing may be written to disk')
  })

  it('aborts without writing anything when checksums.txt is missing (404)', async () => {
    const deps = baseDeps({
      fetchImpl: stubFetch({
        [checksumsUrl(TAG)]: new Response('not found', { status: 404 }),
        [downloadUrl(TAG, ASSET)]: new Response(ARCHIVE_BYTES, { status: 200 }),
      }),
    })

    await assert.rejects(installRelease(TAG, deps))

    const ops = deps.ops as ReturnType<typeof memoryOps>
    assert.equal(ops.files.size, 0, 'nothing may be written to disk')
  })

  it('aborts without writing anything when checksums.txt is empty', async () => {
    const deps = baseDeps({
      fetchImpl: stubFetch({
        [checksumsUrl(TAG)]: new Response('', { status: 200 }),
        [downloadUrl(TAG, ASSET)]: new Response(ARCHIVE_BYTES, { status: 200 }),
      }),
    })

    await assert.rejects(installRelease(TAG, deps), /empty/i)

    const ops = deps.ops as ReturnType<typeof memoryOps>
    assert.equal(ops.files.size, 0, 'nothing may be written to disk')
  })

  it('aborts without writing anything when checksums.txt has no entry for this asset', async () => {
    const deps = baseDeps({
      fetchImpl: stubFetch({
        [checksumsUrl(TAG)]: new Response(
          `${sha256(ARCHIVE_BYTES)}  some-other-asset.tar.gz`,
          { status: 200 },
        ),
        [downloadUrl(TAG, ASSET)]: new Response(ARCHIVE_BYTES, { status: 200 }),
      }),
    })

    await assert.rejects(installRelease(TAG, deps), /no checksum/i)

    const ops = deps.ops as ReturnType<typeof memoryOps>
    assert.equal(ops.files.size, 0, 'nothing may be written to disk')
  })

  it('cleans up the temp archive and extraction directory on failure', async () => {
    const deps = baseDeps({
      fetchImpl: stubFetch({
        [checksumsUrl(TAG)]: new Response(GOOD_CHECKSUMS, { status: 200 }),
        [downloadUrl(TAG, ASSET)]: new Response('tampered', { status: 200 }),
      }),
    })

    await assert.rejects(installRelease(TAG, deps))

    const ops = deps.ops as ReturnType<typeof memoryOps>
    assert.equal(ops.files.size, 0, 'archive and extraction dir must both be gone')
  })

  it('never spawns the extractor before the checksum has been verified', async () => {
    const runCalls: string[][] = []
    const ops = memoryOps()
    const deps = baseDeps({
      ops,
      run: (command, args) => {
        runCalls.push([command, ...args])
        return Promise.resolve({ stdout: '', stderr: '', code: 0 } satisfies RunOutput)
      },
      fetchImpl: stubFetch({
        [checksumsUrl(TAG)]: new Response(GOOD_CHECKSUMS, { status: 200 }),
        [downloadUrl(TAG, ASSET)]: new Response('tampered', { status: 200 }),
      }),
    })

    await assert.rejects(installRelease(TAG, deps))
    assert.equal(runCalls.length, 0, 'the archive must never be extracted when unverified')
  })

  it('fails when the extractor reports a non-zero exit code', async () => {
    const deps = baseDeps({
      run: () => Promise.resolve({ stdout: '', stderr: 'bad archive', code: 1 } satisfies RunOutput),
    })

    await assert.rejects(installRelease(TAG, deps), /extracting.*failed/i)
  })

  it('fails when the extracted archive does not contain the expected binary', async () => {
    const deps = baseDeps({
      run: () => Promise.resolve({ stdout: '', stderr: '', code: 0 } satisfies RunOutput),
    })

    await assert.rejects(installRelease(TAG, deps), /does not contain/i)
  })

  it('reports the download and verify step ids in order', async () => {
    // onStep is typed as WizardStepId, so a renamed/removed id in wizard.ts
    // fails this to compile rather than silently breaking a string match.
    const seen: WizardStepId[] = []
    const deps = baseDeps({ onStep: (id) => seen.push(id) })
    await installRelease(TAG, deps)
    assert.deepEqual(seen, ['download-binary', 'verify-binary'])
  })
})

describe('refusesManagedInstall', () => {
  const managedState: ExtensionState = computeState({
    source: 'managed',
    managedPath: '/storage/bin/codebase-memory-mcp',
    externalPath: null,
  })

  const externalState: ExtensionState = computeState({
    source: 'external',
    managedPath: null,
    externalPath: '/home/user/.local/bin/codebase-memory-mcp',
  })

  it('refuses when the setting is forced to external, regardless of state', () => {
    assert.equal(refusesManagedInstall('external', managedState), true)
  })

  it('refuses when the resolved state is external even under auto', () => {
    assert.equal(refusesManagedInstall('auto', externalState), true)
  })

  it('allows a managed state under auto or managed', () => {
    assert.equal(refusesManagedInstall('auto', managedState), false)
    assert.equal(refusesManagedInstall('managed', managedState), false)
  })
})

describe('installLatest', () => {
  it('resolves the latest tag and installs it', async () => {
    const ops = memoryOps()
    const deps = baseDeps({
      ops,
      fetchImpl: async (url, init) => {
        if (url === 'https://github.com/DeusData/codebase-memory-mcp/releases/latest') {
          return new Response(null, {
            status: 302,
            headers: { location: `https://github.com/DeusData/codebase-memory-mcp/releases/tag/${TAG}` },
          })
        }
        return stubFetch({
          [checksumsUrl(TAG)]: new Response(GOOD_CHECKSUMS, { status: 200 }),
          [downloadUrl(TAG, ASSET)]: new Response(ARCHIVE_BYTES, { status: 200 }),
        })(url, init)
      },
    })

    const result = await installLatest(deps)
    assert.equal(result.tag, TAG)
    assert.equal(result.path, '/storage/bin/codebase-memory-mcp')
  })
})
