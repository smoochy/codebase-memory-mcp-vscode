import { BINARY_BASE, UPSTREAM } from '../constants'

export type Variant = 'standard' | 'ui'

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
 * Release asset name for a platform and variant.
 *
 * Windows publishes .zip, darwin and linux .tar.gz. The linux `-portable`
 * assets are deliberately unused — the standard build runs everywhere.
 */
export function assetName(p: Platform, variant: Variant): string {
  const os = OS_NAMES[p.platform]
  if (os === undefined) {
    throw new Error(`unsupported platform: ${p.platform}`)
  }
  const arch = ARCH_NAMES[p.arch]
  if (arch === undefined) {
    throw new Error(`unsupported architecture: ${p.arch}`)
  }
  const suffix = p.platform === 'win32' ? 'zip' : 'tar.gz'
  const variantPart = variant === 'ui' ? '-ui' : ''
  return `${BINARY_BASE}${variantPart}-${os}-${arch}.${suffix}`
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

/** Segment-wise numeric comparison; missing segments count as zero. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((segment) => Number.parseInt(segment, 10) || 0)

  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

export function binaryFileName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${BINARY_BASE}.exe` : BINARY_BASE
}
