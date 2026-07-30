import * as assert from 'node:assert/strict'
import {
  firstRegistration,
  mcpConfigCandidates,
  readRegistration,
  stripJsonComments,
} from '../../src/mcp/registration'

describe('stripJsonComments', () => {
  it('removes line and block comments', () => {
    assert.equal(stripJsonComments('{"a":1} // note'), '{"a":1} ')
    assert.equal(stripJsonComments('{/* note */"a":1}'), '{"a":1}')
  })

  it('keeps comment-like text inside strings', () => {
    assert.equal(stripJsonComments('{"a":"http://x//y"}'), '{"a":"http://x//y"}')
    assert.equal(stripJsonComments('{"a":"/* keep */"}'), '{"a":"/* keep */"}')
  })

  it('keeps an escaped quote from ending the string', () => {
    assert.equal(stripJsonComments('{"a":"say \\" // x"}'), '{"a":"say \\" // x"}')
  })
})

describe('readRegistration', () => {
  it('reports unknown when the file cannot be read', () => {
    assert.deepEqual(readRegistration(null), { kind: 'unknown' })
  })

  it('reports unknown when the file is not valid JSON', () => {
    assert.deepEqual(readRegistration('{ broken'), { kind: 'unknown' })
  })

  it('reports missing when no server entry matches', () => {
    assert.deepEqual(readRegistration('{"servers":{"other":{"command":"x"}}}'), {
      kind: 'missing',
    })
  })

  it('reports missing when the servers object is absent', () => {
    assert.deepEqual(readRegistration('{}'), { kind: 'missing' })
  })

  it('returns the command path of the registered server', () => {
    const text = '{"servers":{"codebase-memory-mcp":{"command":"C:/bin/cmm.exe","args":["mcp"]}}}'
    assert.deepEqual(readRegistration(text), { kind: 'present', path: 'C:/bin/cmm.exe' })
  })

  it('accepts the alternative key used by older installs', () => {
    const text = '{"mcpServers":{"codebase-memory":{"command":"/usr/bin/cmm"}}}'
    assert.deepEqual(readRegistration(text), { kind: 'present', path: '/usr/bin/cmm' })
  })

  it('tolerates comments, which VS Code allows in mcp.json', () => {
    const text = '{\n// mine\n"servers":{"codebase-memory-mcp":{"command":"/usr/bin/cmm"}}}'
    assert.deepEqual(readRegistration(text), { kind: 'present', path: '/usr/bin/cmm' })
  })

  it('reports missing when the entry has no usable command', () => {
    assert.deepEqual(readRegistration('{"servers":{"codebase-memory-mcp":{"args":[]}}}'), {
      kind: 'missing',
    })
  })
})

describe('mcpConfigCandidates', () => {
  const windows = {
    platform: 'win32' as NodeJS.Platform,
    home: 'C:/Users/x',
    appData: 'C:/Users/x/AppData/Roaming',
    profileDir: undefined,
  }

  it('uses the roaming directory on Windows', () => {
    assert.deepEqual(mcpConfigCandidates(windows), ['C:/Users/x/AppData/Roaming/Code/User/mcp.json'])
  })

  it('falls back to a derived roaming path when APPDATA is unset', () => {
    assert.deepEqual(mcpConfigCandidates({ ...windows, appData: undefined }), [
      'C:/Users/x/AppData/Roaming/Code/User/mcp.json',
    ])
  })

  it('uses the application support directory on macOS', () => {
    const candidates = mcpConfigCandidates({
      platform: 'darwin',
      home: '/Users/x',
      appData: undefined,
      profileDir: undefined,
    })
    assert.deepEqual(candidates, ['/Users/x/Library/Application Support/Code/User/mcp.json'])
  })

  it('uses the config directory on Linux', () => {
    const candidates = mcpConfigCandidates({
      platform: 'linux',
      home: '/home/x',
      appData: undefined,
      profileDir: undefined,
    })
    assert.deepEqual(candidates, ['/home/x/.config/Code/User/mcp.json'])
  })

  it('puts the active profile ahead of the default profile', () => {
    const candidates = mcpConfigCandidates({ ...windows, profileDir: '-abc123' })
    assert.deepEqual(candidates, [
      'C:/Users/x/AppData/Roaming/Code/User/profiles/-abc123/mcp.json',
      'C:/Users/x/AppData/Roaming/Code/User/mcp.json',
    ])
  })
})

describe('firstRegistration', () => {
  const registered = '{"servers":{"codebase-memory-mcp":{"command":"/usr/bin/cmm"}}}'

  it('returns the first file that has an entry', () => {
    assert.deepEqual(firstRegistration([null, '{}', registered]), {
      kind: 'present',
      path: '/usr/bin/cmm',
    })
  })

  it('reports missing when a readable file exists but has no entry', () => {
    assert.deepEqual(firstRegistration([null, '{}']), { kind: 'missing' })
  })

  it('reports unknown when no file could be read at all', () => {
    assert.deepEqual(firstRegistration([null, null]), { kind: 'unknown' })
  })

  it('reports unknown for an empty candidate list', () => {
    assert.deepEqual(firstRegistration([]), { kind: 'unknown' })
  })
})
