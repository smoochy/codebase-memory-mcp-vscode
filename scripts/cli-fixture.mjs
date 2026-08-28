// The pinned CLI binary the autotest run tests against.
//
// Real, pinned, downloaded once per machine and cached outside the checkout.
// Not checked in, not built from the sibling repository, not stubbed: the rows
// this fixture serves exist to check a real daemon and a real `mcp.json`
// written by a real installation, and a stub would make them green while
// removing the only thing they measure.
//
// The download, checksum and extraction machinery is not reimplemented here.
// `src/binary/` already carries it, including the host allowlist every release
// request is checked against and the bsdtar-versus-GNU-tar trap on Windows, so
// this module composes the compiled `out/src/binary/*.js` rather than growing a
// second copy that has to be kept in step with upstream's archive formats.
//
// Plain JavaScript rather than TypeScript because `scripts/autotest.mjs` runs
// it, and that script is deliberately runnable by hand.

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

export const PIN_PATH = join(repoRoot, 'test', 'fixtures', 'cli-pin.json')

/**
 * The compiled extension modules this script borrows.
 *
 * Resolved lazily and by hand rather than at import time: the pure helpers
 * below are unit-tested before `compile:test` has necessarily run, and a
 * top-level import would make importing this file at all depend on `out/`.
 */
function compiled() {
  const out = join(repoRoot, 'out', 'src', 'binary')
  if (!existsSync(join(out, 'assets.js'))) {
    throw new Error('out/src/binary is missing - run `npm run compile:test` first')
  }
  return {
    assets: require(join(out, 'assets.js')),
    fetchModule: require(join(out, 'fetch.js')),
    install: require(join(out, 'install.js')),
  }
}

/** Key of one platform's entry in the pin file. */
export function pinKey(platform, arch) {
  return `${platform}-${arch}`
}

export function readPin(path = PIN_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * The tag, asset and expected digest for one entry on one platform.
 *
 * An unknown entry or an unlisted platform throws rather than falling back to
 * a neighbouring architecture: a run that silently tested the amd64 build on an
 * arm64 machine would be answering a different question than the one asked.
 */
export function resolvePin(pin, entry, platform, arch) {
  const record = pin.entries?.[entry]
  if (record === undefined) {
    throw new Error(`no such pin entry: ${entry}`)
  }
  const key = pinKey(platform, arch)
  const asset = record.assets?.[key]
  if (asset === undefined) {
    throw new Error(`pin entry ${entry} lists no asset for ${key}`)
  }
  if (!/^[0-9a-f]{64}$/.test(asset.sha256)) {
    throw new Error(`pin entry ${entry} has a malformed sha256 for ${key}`)
  }
  return { entry, tag: record.tag, asset: asset.asset, sha256: asset.sha256.toLowerCase() }
}

/**
 * Where downloaded fixtures are kept. Outside the checkout on purpose: nothing
 * about the binary may ever show up in `git status`, or it would trip the
 * unattended loop's own diff backstop and be wiped by the checkout restore at
 * the end of a run.
 */
export function cacheRoot(env, platform) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA
    if (!local) {
      throw new Error('LOCALAPPDATA is unset, so there is nowhere to cache the CLI fixture')
    }
    return join(local, 'cmm-autotest')
  }
  const home = env.HOME
  if (!home) {
    throw new Error('HOME is unset, so there is nowhere to cache the CLI fixture')
  }
  return join(home, '.cache', 'cmm-autotest')
}

/**
 * Why an acquisition failed, in the only distinction the report has to keep.
 *
 * A network failure is boring and leaves the fixture rows as named residue. A
 * pinned asset whose digest no longer matches is not boring: it is either a
 * corrupted cache or a substituted release, and it must never be reported as
 * the same kind of absence.
 */
export function classifyAcquisitionError(error) {
  const message = String(error?.message ?? error)
  if (/checksum mismatch|no checksum published/iu.test(message)) {
    return 'checksum'
  }
  if (/^(no such pin entry|pin entry|LOCALAPPDATA|HOME|out\/src\/binary)/u.test(message)) {
    return 'pin'
  }
  return 'network'
}

/** Only the exact expected file name counts, one level of nesting deep. */
function findExtractedBinary(dir, name) {
  const direct = join(dir, name)
  if (existsSync(direct)) {
    return direct
  }
  for (const entry of readdirSync(dir)) {
    const nested = join(dir, entry, name)
    if (existsSync(nested)) {
      return nested
    }
  }
  throw new Error(`the release archive does not contain ${name}`)
}

/**
 * Put one pinned release in the cache and return the binary's path.
 *
 * The cache is keyed by tag and carries a marker naming the digest that was
 * verified, so a second round reuses the extraction instead of re-downloading
 * ~282 MB - but a pin bump invalidates it, because the marker no longer
 * matches what the pin now asks for.
 */
export async function acquire({ pin, entry, platform, arch, env }) {
  const { assets, fetchModule, install } = compiled()
  const resolved = resolvePin(pin, entry, platform, arch)

  // The pin is the authority, not upstream's checksums.txt: re-reading the
  // published file would accept a re-cut release under the same tag, which is
  // exactly the substitution the pin exists to notice.
  const expected = assets.assetName({ platform, arch })
  if (expected !== resolved.asset) {
    throw new Error(
      `pin entry ${entry} names ${resolved.asset} but the extension asks for ${expected}`,
    )
  }

  const tagDir = join(cacheRoot(env, platform), resolved.tag)
  const name = binaryFileName(platform)
  const marker = join(tagDir, '.verified')
  const cached = join(tagDir, name)

  if (existsSync(cached) && existsSync(marker) && readFileSync(marker, 'utf8').trim() === resolved.sha256) {
    return { ...resolved, path: cached, cached: true }
  }

  rmSync(tagDir, { recursive: true, force: true })
  mkdirSync(tagDir, { recursive: true })

  const url = assets.downloadUrl(resolved.tag, resolved.asset)
  const fetchImpl = fetchModule.withRetry((target, init) => fetch(target, init))
  const bytes = await fetchModule.downloadVerified(
    url,
    resolved.asset,
    `${resolved.sha256}  ${resolved.asset}\n`,
    fetchImpl,
  )

  const archive = join(tagDir, resolved.asset)
  writeFileSync(archive, bytes)

  const extractDir = join(tagDir, 'extract')
  mkdirSync(extractDir, { recursive: true })
  const { command, args } = install.extractCommand(
    archive,
    extractDir,
    install.tarCommand(platform, env.SystemRoot, existsSync),
  )
  const extraction = spawnSync(command, args, { encoding: 'utf8' })
  if (extraction.error) {
    throw extraction.error
  }
  if (extraction.status !== 0) {
    throw new Error(
      `extracting ${resolved.asset} failed with exit ${String(extraction.status)}: ` +
        `${(extraction.stderr ?? '').trim()}`,
    )
  }

  copyFileSync(findExtractedBinary(extractDir, name), cached)
  rmSync(archive, { force: true })
  rmSync(extractDir, { recursive: true, force: true })
  // The marker is written last, so an interrupted acquisition leaves a cache
  // that the next run replaces rather than one it trusts.
  writeFileSync(marker, `${resolved.sha256}\n`)

  return { ...resolved, path: cached, cached: false }
}

/** Local fallback for the compiled helper, so the pure path needs no `out/`. */
export function binaryFileName(platform) {
  return platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp'
}

/** Where a provisioned fixture lands - the first entry `externalCandidates()` searches. */
export function fixtureInstallPath(scratchHome, platform) {
  return join(scratchHome, '.local', 'bin', binaryFileName(platform))
}

/**
 * Copy one cached fixture into a round's scratch home.
 *
 * The extension's own installer chmods what it installs; this copy bypasses
 * that code entirely, and both a naive tar extractor and a plain copy can land
 * the binary unexecutable - so the mode is set here rather than assumed.
 *
 * The quarantine attribute is cleared unconditionally on darwin. Whether it
 * was ever set depends on how the bytes arrived, and the no-op costs nothing
 * next to a whole class of "green locally, Gatekeeper-blocked elsewhere".
 */
export function provision(binaryPath, scratchHome, platform) {
  const target = fixtureInstallPath(scratchHome, platform)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(binaryPath, target)
  if (platform !== 'win32') {
    chmodSync(target, 0o755)
  }
  if (platform === 'darwin') {
    spawnSync('xattr', ['-d', 'com.apple.quarantine', target], { encoding: 'utf8' })
  }
  return target
}
