import * as assert from 'node:assert/strict'
import { engineLogDirectory, gitBashCandidates, projectStorePath } from '../../src/binary/shells'

describe('gitBashCandidates', () => {
  it('looks where Git for Windows installs itself', () => {
    const found = gitBashCandidates({
      programFiles: 'C:\\Program Files',
      programFilesX86: undefined,
      localAppData: undefined,
    })
    assert.ok(found.includes('C:/Program Files/Git/bin/bash.exe'))
  })

  it('covers a per-user install under LocalAppData', () => {
    const found = gitBashCandidates({
      programFiles: undefined,
      programFilesX86: undefined,
      localAppData: 'C:/Users/me/AppData/Local',
    })
    assert.ok(found.includes('C:/Users/me/AppData/Local/Programs/Git/bin/bash.exe'))
  })

  it('yields nothing when the environment says nothing', () => {
    assert.deepEqual(
      gitBashCandidates({ programFiles: undefined, programFilesX86: undefined, localAppData: '' }),
      [],
    )
  })
})

describe('engineLogDirectory', () => {
  // Verified against the real machine: the CLI names this directory in its own
  // crash output, e.g. log=C:/Users/<me>/.cache/codebase-memory-mcp/logs/...
  it('points at the cache directory the CLI writes to', () => {
    assert.equal(
      engineLogDirectory('C:/Users/me'),
      'C:/Users/me/.cache/codebase-memory-mcp/logs',
    )
  })

  it('normalises a Windows home with backslashes', () => {
    assert.equal(
      engineLogDirectory('C:\\Users\\me'),
      'C:/Users/me/.cache/codebase-memory-mcp/logs',
    )
  })
})

describe('projectStorePath', () => {
  it('names the store file the CLI writes per project', () => {
    assert.equal(
      projectStorePath('C:/Users/me', 'C-projects-example-repo'),
      'C:/Users/me/.cache/codebase-memory-mcp/C-projects-example-repo.db',
    )
  })

  // The name is CLI output interpolated into a path, so a separator or a
  // traversal segment would point the lookup somewhere else entirely.
  for (const hostile of ['../../../etc/passwd', 'a/b', 'a\\b', '..', '.hidden', '']) {
    it(`refuses a name that is not a plain file name: "${hostile}"`, () => {
      assert.equal(projectStorePath('C:/Users/me', hostile), null)
    })
  }
})
