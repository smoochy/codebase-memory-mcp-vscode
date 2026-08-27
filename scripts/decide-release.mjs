#!/usr/bin/env node
// Decides whether the commit now on `main` is a release, and writes the
// decision to `GITHUB_OUTPUT`.
//
// The manifest is the only signal: no label is read. The predicate is the same
// one `check-version-bump.mjs` uses to decide whether a pull request is a
// release, and it imports that comparison rather than restating it, so the
// pull-request check and this merge gate can never disagree.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { compareSemver, newestTag } from './check-version-bump.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })

export function decide(version, tags) {
  // Every docs, chore and Renovate merge lands here: the version is whatever
  // the last release set it to, and its tag already exists.
  if (tags.some((tag) => tag.trim() === `v${version}`)) {
    return { release: false, reason: `v${version} already exists, nothing to release` }
  }

  const newest = newestTag(tags)
  if (!newest) {
    throw new Error('no v* tag found - ensure the checkout used fetch-depth: 0 and fetched tags')
  }

  // A version that is not strictly greater is a revert or a broken merge. A
  // marketplace version line cannot be walked back, so this fails loudly rather
  // than skipping quietly like the branch above.
  if (compareSemver(version, newest.slice(1)) <= 0) {
    throw new Error(
      `package.json says ${version}, which is not above the newest tag ${newest} - a released version line cannot be walked back`,
    )
  }

  return { release: true, tag: `v${version}`, reason: `releasing v${version}, above ${newest}` }
}

function main() {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const decision = decide(version, git('tag', '--list', 'v*').split('\n'))
  console.log(decision.reason)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `release=${decision.release}\n` + (decision.tag ? `tag=${decision.tag}\n` : ''),
  )
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
