import { BINARY_BASE, UPSTREAM } from '../constants'

export interface Platform {
  platform: NodeJS.Platform
  arch: string
}

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'windows',
  darwin: 'darwin',
  linux: 'linux',
}

const ARCH_NAMES: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
}

const RELEASES = `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}/releases`

/**
 * Release asset name for a platform.
 *
 * Windows publishes .zip, darwin and linux .tar.gz. The linux `-portable`
 * assets are deliberately unused - the standard build runs everywhere. The
 * `-ui` names are unused for the same reason: 0.10.0 dropped the ui/non-ui
 * split and always embeds the UI, republishing `ui-*` copies only so old
 * updaters keep resolving.
 */
export function assetName(p: Platform): string {
  const os = OS_NAMES[p.platform]
  if (os === undefined) {
    throw new Error(`unsupported platform: ${p.platform}`)
  }
  const arch = ARCH_NAMES[p.arch]
  if (arch === undefined) {
    throw new Error(`unsupported architecture: ${p.arch}`)
  }
  const suffix = p.platform === 'win32' ? 'zip' : 'tar.gz'
  return `${BINARY_BASE}-${os}-${arch}.${suffix}`
}

/** Reject anything that could escape the release path when interpolated. */
function assertPlainAssetName(asset: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(asset) || asset === '.' || asset === '..') {
    throw new Error(`invalid asset name: ${asset}`)
  }
}

export function downloadUrl(tag: string, asset: string): string {
  assertPlainAssetName(asset)
  assertPlainAssetName(tag)
  return `${RELEASES}/download/${tag}/${asset}`
}

export function checksumsUrl(tag: string): string {
  return downloadUrl(tag, 'checksums.txt')
}

export function latestReleaseUrl(): string {
  return `${RELEASES}/latest`
}

/**
 * The upstream project page.
 *
 * Linked from the panel rather than a release URL: what `/releases/latest`
 * resolves to is upstream's choice, so if they ever stop tagging that way the
 * link would quietly point at an old build while the extension downloads a
 * different one.
 */
export function upstreamRepoUrl(): string {
  return `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}`
}

/** `releaseNotesUrl` for callers that render a version they cannot vouch for. */
export function releaseNotesUrlOrNull(version: string): string | null {
  try {
    return releaseNotesUrl(version)
  } catch {
    return null
  }
}

export function releaseNotesUrl(version: string): string {
  const tag = version.startsWith('v') ? version : `v${version}`
  assertPlainAssetName(tag)
  return `${RELEASES}/tag/${tag}`
}

/**
 * Read the tag from the Location header of `/releases/latest`.
 * Verified: it redirects to `/releases/tag/v0.9.0`.
 */
export function tagFromLocation(location: string): string | null {
  const match = /\/releases\/tag\/([A-Za-z0-9._-]+)$/.exec(location)
  return match?.[1] ?? null
}

/**
 * Segment-wise numeric comparison; missing segments count as zero.
 *
 * A pre-release sorts below the release it precedes: without that, `parseInt`
 * read `0.9.1-rc.1` as `0.9.1` and the update badge would offer a release
 * candidate as if it were the final. Upstream publishes such tags, so this is
 * a wrong answer waiting for something other than `/releases/latest` - which
 * never resolves to a pre-release - to feed it a tag.
 */
export function compareVersions(a: string, b: string): number {
  // ponytail: the pre-release tail is compared as one string, so `rc.10` sorts
  // below `rc.2`. Upgrade to per-identifier semver precedence if upstream ever
  // publishes a double-digit pre-release the badge has to order.
  const parse = (v: string): { core: number[]; pre: string } => {
    const [core, ...rest] = v.replace(/^v/, '').split('-')
    return {
      core: (core ?? '').split('.').map((segment) => Number.parseInt(segment, 10) || 0),
      pre: rest.join('-'),
    }
  }

  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.core.length, right.core.length)

  for (let i = 0; i < length; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }

  if (left.pre === right.pre) {
    return 0
  }
  if (left.pre === '') {
    return 1
  }
  if (right.pre === '') {
    return -1
  }
  return left.pre < right.pre ? -1 : 1
}

export function binaryFileName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${BINARY_BASE}.exe` : BINARY_BASE
}
