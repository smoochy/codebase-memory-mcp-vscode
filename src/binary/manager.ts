import { assetName, binaryFileName, checksumsUrl, downloadUrl, type Variant } from './assets'
import { downloadVerified, followRedirects, resolveLatestTag, type FetchLike } from './fetch'
import { extractCommand, replaceBinary, tarCommand, type FileOps } from './install'
import type { Runner } from '../cli/client'
import type { BinarySource, ExtensionState } from '../state/machine'
import type { WizardStepId } from '../setup/wizard'
import { assertAllowedUrl } from './verify'

/**
 * Whether an install/update must be refused because the extension does not
 * own the active binary: the user forced `external`, or the resolved state
 * (which can fall back across sources) landed on an external binary anyway.
 */
export function refusesManagedInstall(source: BinarySource, state: ExtensionState): boolean {
  return source === 'external' || state.effectiveSource === 'external'
}

/**
 * Filesystem surface the install flow needs on top of {@link FileOps}: it must
 * find the extracted binary inside the archive and drop the scratch directory.
 */
export interface InstallFileOps extends FileOps {
  /** Entries directly inside `dir`, as `dir`-relative names. */
  listDir(dir: string): string[]
  /** Read a file as bytes. */
  read(p: string): Uint8Array
  /** Remove a directory and everything under it. Must not throw if absent. */
  removeDir(p: string): void
}

export interface InstallDeps {
  fetchImpl: FetchLike
  run: Runner
  ops: InstallFileOps
  platform: NodeJS.Platform
  arch: string
  /** Work area for the download and extraction. Scratch only. */
  storageDir: string
  /**
   * Absolute path the finished binary is moved to.
   *
   * Separate from storageDir because the CLI registers this exact path as its
   * MCP server command, so it has to be the one on PATH rather than a private
   * location the extension chose.
   */
  installPath: string
  /** SystemRoot on Windows, so bsdtar can be named in full. Unused elsewhere. */
  systemRoot?: string
  variant?: Variant
  /** Progress log sink. Callers redact before forwarding to a channel. */
  log?: (message: string) => void
  /** Reports the wizard step id currently in progress. Callers resolve it to a title. */
  onStep?: (id: WizardStepId) => void
  /**
   * How far the install has come, 0 to 100.
   *
   * The download is what takes minutes, so it owns most of the scale; the
   * remainder covers extracting and replacing the binary, which is seconds.
   */
  onProgress?: (percent: number) => void
  extractTimeoutMs?: number
}

const EXTRACT_TIMEOUT_MS = 120_000

/**
 * Stopping the daemon is a local socket round trip; measured, it returns in
 * well under a second whether one is running or not.
 */
const DAEMON_STOP_TIMEOUT_MS = 30_000

/** Where an install ended up, and whether the old daemon was retired with it. */
export interface InstallResult {
  /** Absolute path of the installed binary. */
  path: string
  /**
   * Why the surviving daemon could not be stopped, or undefined when it was.
   *
   * Not a failure of the install: the binary is in place either way. It is the
   * difference between an update that works on the next call and one where
   * every call fails until the user retires the daemon by hand.
   */
  daemonStopError?: string
}

/** Share of the progress scale the download owns; the rest is extract plus move. */
const DOWNLOAD_SHARE = 90

/** Same forward-slash join `locate.ts` uses, so paths compare cleanly. */
function join(...parts: string[]): string {
  return parts.map((p) => p.replace(/\\/g, '/').replace(/\/+$/, '')).join('/')
}

/**
 * Locate the binary inside the extraction directory.
 *
 * Releases sometimes nest the binary one level down, so a single level of
 * subdirectories is searched. Only the exact expected file name is accepted -
 * an archive that happens to carry extra executables cannot substitute one.
 */
function findExtractedBinary(dir: string, platform: NodeJS.Platform, ops: InstallFileOps): string {
  const wanted = binaryFileName(platform)

  const direct = join(dir, wanted)
  if (ops.exists(direct)) {
    return direct
  }

  for (const entry of ops.listDir(dir)) {
    const nested = join(dir, entry, wanted)
    if (ops.exists(nested)) {
      return nested
    }
  }

  throw new Error(`the release archive does not contain ${wanted}`)
}

/**
 * Download, verify and install the release for `tag` into the managed location.
 *
 * The only byte path to disk runs through {@link downloadVerified}, which
 * throws unless the SHA-256 of the downloaded archive matches the digest
 * published in `checksums.txt`. There is no branch that installs without that
 * check: a checksums file that cannot be fetched, or that lists no entry for
 * this asset, propagates as a rejection before any write happens.
 */
export async function installRelease(tag: string, deps: InstallDeps): Promise<InstallResult> {
  const { fetchImpl, run, ops, platform, arch, storageDir } = deps
  const step = deps.onStep ?? ((): void => {})
  const log = deps.log ?? ((): void => {})

  const asset = assetName({ platform, arch }, deps.variant ?? 'standard')

  step('download-binary')
  // Fetch the published digests first. An unreachable, empty or malformed
  // checksums file must abort the install, never downgrade it to "unverified".
  const checksumsResponse = await followRedirects(
    assertAllowedUrl(checksumsUrl(tag)).toString(),
    fetchImpl,
  )
  const checksums = await checksumsResponse.text()
  if (checksums.trim().length === 0) {
    throw new Error(`checksums.txt for ${tag} is empty; refusing to install unverified bytes`)
  }

  const url = assertAllowedUrl(downloadUrl(tag, asset)).toString()
  log(`downloading ${url}`)

  step('verify-binary')
  const progress = deps.onProgress
  const archiveBytes = await downloadVerified(
    url,
    asset,
    checksums,
    fetchImpl,
    progress === undefined
      ? undefined
      : (fraction) => {
          progress(Math.round(fraction * DOWNLOAD_SHARE))
        },
  )
  progress?.(DOWNLOAD_SHARE)

  // Everything below stays inside the extension's own global storage.
  const workDir = join(storageDir, 'download')
  const archivePath = join(workDir, asset)
  const extractDir = join(workDir, 'unpacked')

  try {
    ops.removeDir(extractDir)
    ops.mkdirp(extractDir)
    ops.mkdirp(workDir)
    ops.write(archivePath, archiveBytes)

    const { command, args } = extractCommand(
      archivePath,
      extractDir,
      tarCommand(platform, deps.systemRoot, ops.exists),
    )
    const result = await run(command, args, deps.extractTimeoutMs ?? EXTRACT_TIMEOUT_MS)
    if (result.code !== 0) {
      throw new Error(
        `extracting ${asset} failed with code ${String(result.code)}: ${result.stderr.trim()}`,
      )
    }

    const extracted = findExtractedBinary(extractDir, platform, ops)
    const target = deps.installPath

    // No dedicated wizard step for this instant, in-process move; it is still
    // covered by the 'verify-binary' step the user is looking at.
    replaceBinary(target, ops.read(extracted), platform, ops)
    progress?.(100)
    log(`installed ${tag} at ${target}`)
    return { path: target, daemonStopError: await stopDaemon(target, run, log) }
  } finally {
    // Best effort on both the success and the failure path: a leftover archive
    // is only wasted space, and a failure to clean it must not mask the cause.
    try {
      ops.remove(archivePath)
    } catch {
      /* already gone, or locked */
    }
    try {
      ops.removeDir(extractDir)
    } catch {
      /* already gone, or locked */
    }
  }
}

/**
 * Retire the daemon left over from the binary that was just replaced.
 *
 * From 0.10.0 the CLI starts a per-user daemon on its first call and calls it
 * permanent: it outlives the session, so replacing the binary underneath it
 * leaves it running at the old version. It then refuses every client of a
 * different build outright - measured, a 0.10.3 client against a running
 * 0.10.2 daemon exits 1 with "a conflicting CBM process is active" - so
 * without this every CLI call fails after an update, and reloading the window
 * does not help, the daemon being a separate surviving process.
 *
 * The newly installed binary is what runs the stop, and it stops a daemon of
 * another version fine. Measured against 0.10.2 and 0.10.3, `daemon stop` is
 * forgiving to the point that no non-zero exit could be produced: absent, and
 * stale after the recorded process was killed, both report "nothing to stop"
 * and exit 0. The non-zero branch is therefore the ordinary exit-code check
 * this file already makes on extraction, not a case that has been observed;
 * what is reachable is a spawn failure, which throws.
 *
 * A 0.9.x binary has no `daemon` subcommand and no daemon to stop, so its
 * non-zero exit is reported for the same reason as any other: the install
 * still succeeded, and the message says only that the stop did not happen.
 */
async function stopDaemon(
  target: string,
  run: Runner,
  log: (message: string) => void,
): Promise<string | undefined> {
  try {
    const result = await run(target, ['daemon', 'stop'], DAEMON_STOP_TIMEOUT_MS)
    if (result.code !== 0) {
      return result.stderr.trim() || result.stdout.trim() || `exited with ${String(result.code)}`
    }
    log('retired the previous daemon')
    return undefined
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

/** Resolve the latest tag and install it. Returns the tag and the install. */
export async function installLatest(
  deps: InstallDeps,
): Promise<InstallResult & { tag: string }> {
  const tag = await resolveLatestTag(deps.fetchImpl)
  return { tag, ...(await installRelease(tag, deps)) }
}
