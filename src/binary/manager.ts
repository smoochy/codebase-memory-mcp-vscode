import { assetName, binaryFileName, checksumsUrl, downloadUrl, type Variant } from './assets'
import { downloadVerified, followRedirects, resolveLatestTag, type FetchLike } from './fetch'
import { extractCommand, replaceBinary, type FileOps } from './install'
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
export async function installRelease(tag: string, deps: InstallDeps): Promise<string> {
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

    const { command, args } = extractCommand(archivePath, extractDir)
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
    return target
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

/** Resolve the latest tag and install it. Returns the tag and the target path. */
export async function installLatest(
  deps: InstallDeps,
): Promise<{ tag: string; path: string }> {
  const tag = await resolveLatestTag(deps.fetchImpl)
  const path = await installRelease(tag, deps)
  return { tag, path }
}
