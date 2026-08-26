#!/usr/bin/env node
// Asserts that a manifest version bump matches the Conventional Commits it
// claims to cover, and that the changelog carries a section for it.
//
// The check is deliberately silent unless the pull request bumps the version:
// feature branches do not bump, and a job that only reports on some pull
// requests can never be a required status check.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Only plain `major.minor.patch` is understood. Prerelease and build metadata
 *  carry precedence rules this repository has never used, and a silent
 *  mis-comparison is worse than a refusal. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/

/** A Conventional Commits subject line. The `!` may sit after the scope, so it
 *  is matched there rather than on the type alone. */
const SUBJECT = /^(\w+)(\([^)]*\))?(!)?:\s/

/** The breaking footer, as a footer: anywhere-in-the-text matching would fire
 *  on a commit that merely discusses one. */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m

export function parseVersion(version) {
  const match = VERSION.exec(version)
  if (!match) throw new Error(`unsupported version format: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Component-wise, never lexical: `1.10.0` is above `1.9.0`. */
export function compareSemver(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return 0
}

/** The maximum bump the commit messages imply. Commits that do not conform
 *  contribute nothing, so a range of only those still means a patch. */
export function impliedBump(messages) {
  let bump = 'patch'
  for (const message of messages) {
    const subject = SUBJECT.exec(message.split('\n', 1)[0])
    if (!subject) continue
    // A breaking change in 0.x is a minor bump under the conventional-changelog
    // convention. This maps it to a major regardless, per the decision on the
    // map; the repository has been past 1.0.0 since before this check existed.
    if (subject[3] || BREAKING_FOOTER.test(message)) return 'major'
    if (subject[1] === 'feat') bump = 'minor'
  }
  return bump
}

/** Whether the changelog carries a section for this version that would yield
 *  release notes. The heading is anchored, but the anchor has to survive a CRLF
 *  checkout, which is what a bare `$` would not. */
export function hasChangelogSection(changelog, version) {
  const heading = `^## \\[${version.replace(/\./g, '\\.')}\\][ \\t\\r]*$`
  const section = new RegExp(`${heading}([\\s\\S]*?)(?=^## \\[|$(?![\\s\\S]))`, 'm')
  const match = section.exec(changelog)
  return Boolean(match && match[1].trim())
}

export function nextVersion(base, bump) {
  const [major, minor, patch] = parseVersion(base)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })

/** The newest `v*` tag by semver. Tags that are not plain versions are dropped
 *  rather than crashed on, so a stray tag cannot break every pull request. */
export function newestTag(tags) {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => VERSION.test(tag.replace(/^v/, '')) && tag.startsWith('v'))
    .sort((a, b) => compareSemver(b.slice(1), a.slice(1)))[0]
}

function main() {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')).version
  const tag = newestTag(git('tag', '--list', 'v*').split('\n'))
  if (!tag) {
    throw new Error('no v* tag found - ensure the checkout used fetch-depth: 0 and fetched tags')
  }

  // The gate: only a strictly greater manifest is a release, and only a release
  // is checked. Everything else is an ordinary pull request.
  if (compareSemver(manifest, tag.slice(1)) <= 0) return

  try {
    git('merge-base', '--is-ancestor', tag, 'HEAD')
  } catch {
    throw new Error(
      `the newest tag ${tag} is not an ancestor of HEAD - rebase onto main so the commit range is the one that will ship`,
    )
  }

  const messages = git('log', '--no-merges', '--format=%B%x00', `${tag}..HEAD`)
    .split('\0')
    .map((message) => message.trim())
    .filter(Boolean)

  const expected = nextVersion(tag.slice(1), impliedBump(messages))
  if (manifest !== expected) {
    throw new Error(
      `package.json says ${manifest}, but the commits since ${tag} imply ${expected} - set the version to ${expected}`,
    )
  }

  // `release.yaml` extracts the release notes from this section and hard-fails
  // on an empty one, by which point the failure sits on main. Asserting it here
  // is where it still costs one push to fix.
  if (!hasChangelogSection(readFileSync('CHANGELOG.md', 'utf8'), manifest)) {
    throw new Error(`CHANGELOG.md has no non-empty "## [${manifest}]" section`)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
