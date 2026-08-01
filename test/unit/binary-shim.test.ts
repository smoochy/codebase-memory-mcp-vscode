import * as assert from 'node:assert/strict'
import {
  gitBashCandidates,
  installedCopyPath,
  mayReplace,
  shimContents,
  shimDirectory,
  shimPath,
} from '../../src/binary/shim'

const HOME = 'C:/Users/me'

describe('shim paths', () => {
  it('targets the PATH directory the CLI installer uses', () => {
    assert.equal(shimDirectory(HOME), 'C:/Users/me/.local/bin')
  })

  it('normalises a Windows home with backslashes', () => {
    assert.equal(shimDirectory('C:\\Users\\me'), 'C:/Users/me/.local/bin')
  })

  // A .cmd is found via PATHEXT and needs no compiler, but loses to a .exe of
  // the same stem, which is why the installed copy has to go.
  it('uses .cmd on Windows and no extension elsewhere', () => {
    assert.equal(shimPath(HOME, 'win32'), 'C:/Users/me/.local/bin/codebase-memory-mcp.cmd')
    assert.equal(shimPath('/home/me', 'linux'), '/home/me/.local/bin/codebase-memory-mcp')
  })

  it('knows the full copy it replaces', () => {
    assert.equal(installedCopyPath(HOME, 'win32'), 'C:/Users/me/.local/bin/codebase-memory-mcp.exe')
  })
})

describe('shimContents', () => {
  it('forwards arguments with their quoting intact on Windows', () => {
    const script = shimContents('C:/storage/bin/cmm.exe', 'win32')
    assert.match(script, /@echo off/)
    assert.match(script, /"C:\\storage\\bin\\cmm\.exe" %\*/)
  })

  it('execs on POSIX so the shim does not linger as a parent process', () => {
    const script = shimContents('/storage/bin/cmm', 'linux')
    assert.equal(script, "#!/bin/sh\nexec '/storage/bin/cmm' \"$@\"\n")
  })

  // cmd.exe expands %VAR% even inside double quotes, and a percent is legal in
  // a Windows account name, so an unescaped one silently rewrites the path.
  it('escapes a percent in a Windows path', () => {
    const script = shimContents('C:/Users/a%TEMP%b/cmm.exe', 'win32')
    assert.match(script, /"C:\\Users\\a%%TEMP%%b\\cmm\.exe" %\*/)
  })

  // Inside double quotes a POSIX shell still acts on $, a backtick and a
  // backslash, all of which are legal in a path.
  for (const [label, path] of [
    ['a dollar sign', '/home/me/$(id)/cmm'],
    ['a backtick', '/home/me/`id`/cmm'],
    ['a double quote', '/home/me/a"b/cmm'],
    ['a backslash', '/home/me/a\\b/cmm'],
  ] as const) {
    it(`neutralises ${label} on POSIX`, () => {
      const script = shimContents(path, 'linux')
      // Everything between the single quotes is inert; the only way out would
      // be an unescaped single quote.
      const body = script.split('\n')[1]!
      assert.ok(body.startsWith("exec '"), body)
      assert.equal(body.slice(6, body.indexOf("' \"$@\"")), path)
    })
  }

  it('carries a single quote through by closing and reopening the quoting', () => {
    const script = shimContents("/home/me/it's/cmm", 'linux')
    assert.equal(script, "#!/bin/sh\nexec '/home/me/it'\\''s/cmm' \"$@\"\n")
  })
})

describe('mayReplace', () => {
  // Deleting outside the extension's own storage needs a hard rule: only these
  // two exact names, in that one directory.
  it('allows the shim and the installed copy', () => {
    assert.equal(mayReplace('C:/Users/me/.local/bin/codebase-memory-mcp.cmd', HOME, 'win32'), true)
    assert.equal(mayReplace('C:/Users/me/.local/bin/codebase-memory-mcp.exe', HOME, 'win32'), true)
  })

  it('accepts a backslash spelling of the same path', () => {
    assert.equal(mayReplace('C:\\Users\\me\\.local\\bin\\codebase-memory-mcp.exe', HOME, 'win32'), true)
  })

  for (const forbidden of [
    'C:/Users/me/.local/bin/claude.exe',
    'C:/Users/me/.local/bin/../../important.txt',
    'C:/Windows/System32/cmd.exe',
    'C:/Users/me/.local/bin/codebase-memory-mcp.exe.bak',
    'C:/Users/me/.local/bin/sub/codebase-memory-mcp.exe',
  ]) {
    it(`refuses ${forbidden}`, () => {
      assert.equal(mayReplace(forbidden, HOME, 'win32'), false)
    })
  }
})

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
