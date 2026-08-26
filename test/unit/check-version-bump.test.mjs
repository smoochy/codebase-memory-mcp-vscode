import * as assert from 'node:assert/strict'
import {
  compareSemver,
  hasChangelogSection,
  impliedBump,
  newestTag,
  nextVersion,
} from '../../scripts/check-version-bump.mjs'

describe('compareSemver', () => {
  it('compares component-wise rather than lexically', () => {
    assert.equal(compareSemver('1.10.0', '1.9.0'), 1)
    assert.equal(compareSemver('1.1.3', '1.1.3'), 0)
    assert.equal(compareSemver('1.0.0', '2.0.0'), -1)
  })

  it('refuses a version it cannot compare', () => {
    assert.throws(() => compareSemver('1.2.0-rc.1', '1.1.0'), /unsupported version format/)
  })
})

describe('newestTag', () => {
  it('takes the highest version and ignores tags that are not one', () => {
    assert.equal(newestTag(['v1.9.0', 'nightly', 'v1.10.0', 'v1.2.3']), 'v1.10.0')
  })

  it('has no answer when nothing matches', () => {
    assert.equal(newestTag(['nightly', '']), undefined)
  })
})

describe('impliedBump', () => {
  it('reads a breaking footer out of the commit body', () => {
    assert.equal(impliedBump(['fix: tidy\n\nBREAKING CHANGE: the setting moved']), 'major')
  })

  it('reads the bang after a scope', () => {
    assert.equal(impliedBump(['feat(panel)!: drop the old view']), 'major')
  })

  it('takes the maximum across the range', () => {
    assert.equal(impliedBump(['fix: one', 'feat: two', 'chore: three']), 'minor')
  })

  it('falls back to a patch when nothing conforms', () => {
    assert.equal(impliedBump(['chore: bump', 'Merge pull request #1']), 'patch')
  })
})

describe('hasChangelogSection', () => {
  const changelog = '# Changelog\r\n\r\n## [1.2.0]\r\n\r\n- something\r\n\r\n## [1.1.3]\r\n\r\n- older\r\n'

  // A Windows checkout hands the script CRLF, and a `$`-anchored heading does
  // not match one. This is the case that made the check fail on real branches.
  it('finds a section in a CRLF checkout', () => {
    assert.equal(hasChangelogSection(changelog, '1.2.0'), true)
  })

  it('does not find a version that is absent', () => {
    assert.equal(hasChangelogSection(changelog, '1.3.0'), false)
  })

  it('rejects a heading with nothing under it', () => {
    assert.equal(hasChangelogSection('## [1.2.0]\n\n## [1.1.3]\n\n- older\n', '1.2.0'), false)
  })

  it('accepts the last section in the file', () => {
    assert.equal(hasChangelogSection('## [1.2.0]\n\n- something\n', '1.2.0'), true)
  })

  it('does not match a longer version that starts the same', () => {
    assert.equal(hasChangelogSection('## [1.2.01]\n\n- something\n', '1.2.0'), false)
  })
})

describe('nextVersion', () => {
  it('resets the lower components', () => {
    assert.equal(nextVersion('1.1.3', 'minor'), '1.2.0')
    assert.equal(nextVersion('1.1.3', 'major'), '2.0.0')
    assert.equal(nextVersion('1.1.3', 'patch'), '1.1.4')
  })
})
