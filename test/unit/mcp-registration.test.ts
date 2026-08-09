import * as assert from 'node:assert/strict'
import {
  firstRegistration,
  mcpConfigCandidates,
  NO_CONFIG_FILE,
  readRegistration,
  stripJsonComments,
  withMcpEntry,
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

describe('withMcpEntry', () => {
  const parse = (text: string): Record<string, any> => JSON.parse(text) as Record<string, any>

  it('writes an entry VS Code reads, into a file that does not exist yet', () => {
    const written = withMcpEntry(null, 'C:/bin/cmm.exe')
    assert.deepEqual(parse(written).servers['codebase-memory-mcp'], {
      type: 'stdio',
      command: 'C:/bin/cmm.exe',
    })
    assert.deepEqual(readRegistration(written), { kind: 'present', path: 'C:/bin/cmm.exe' })
  })

  it('keeps the other servers and the rest of the file', () => {
    const before = '{ "inputs": [1], "servers": { "other": { "command": "x" } } }'
    const after = parse(withMcpEntry(before, '/bin/cmm'))
    assert.deepEqual(after['inputs'], [1])
    assert.deepEqual(after['servers']['other'], { command: 'x' })
  })

  // Otherwise a machine that registered under the older name gains a second
  // entry under the newer one, and both start the same server.
  it('updates the entry already there rather than adding one beside it', () => {
    const before = '{"servers": {"codebase-memory": {"type": "stdio", "command": "/old/cmm"}}}'
    const after = parse(withMcpEntry(before, '/new/cmm'))
    assert.deepEqual(Object.keys(after['servers']), ['codebase-memory'])
    assert.equal(after['servers']['codebase-memory'].command, '/new/cmm')
  })

  it('replaces a file it cannot parse rather than refusing to register', () => {
    assert.deepEqual(readRegistration(withMcpEntry('{ not json', '/bin/cmm')), {
      kind: 'present',
      path: '/bin/cmm',
    })
  })
})

describe('mcpConfigCandidates', () => {
  const extension = 'smoochy.better-codebase-memory-mcp'

  it('names the sibling of globalStorage on the default profile', () => {
    assert.deepEqual(
      mcpConfigCandidates(`C:/Users/x/AppData/Roaming/Code/User/globalStorage/${extension}`),
      ['C:/Users/x/AppData/Roaming/Code/User/mcp.json'],
    )
  })

  it('names the profile own file on a named profile', () => {
    assert.deepEqual(
      mcpConfigCandidates(`/home/x/.config/Code/User/profiles/-abc123/globalStorage/${extension}`),
      ['/home/x/.config/Code/User/profiles/-abc123/mcp.json'],
    )
  })

  // The bug this replaced: a home-derived path named the real profile's file
  // and reported its registration as this instance's.
  it('follows a custom user-data-dir rather than the home directory', () => {
    assert.deepEqual(mcpConfigCandidates(`D:/tmp/cmm-test/User/globalStorage/${extension}`), [
      'D:/tmp/cmm-test/User/mcp.json',
    ])
  })

  it('accepts backslashes', () => {
    assert.deepEqual(
      mcpConfigCandidates(`C:\\Users\\x\\AppData\\Roaming\\Code\\User\\globalStorage\\${extension}`),
      ['C:/Users/x/AppData/Roaming/Code/User/mcp.json'],
    )
  })

  it('names nothing when the path is not under globalStorage', () => {
    assert.deepEqual(mcpConfigCandidates('/somewhere/else'), [])
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

  // A fresh installation has no mcp.json at all, and reading that as unknown
  // left the panel reporting a registration it did not have.
  it('reports missing when the file is not there', () => {
    assert.deepEqual(firstRegistration([NO_CONFIG_FILE]), { kind: 'missing' })
  })

  it('reports unknown when no file could be read at all', () => {
    assert.deepEqual(firstRegistration([null, null]), { kind: 'unknown' })
  })

  it('reports unknown for an empty candidate list', () => {
    assert.deepEqual(firstRegistration([]), { kind: 'unknown' })
  })
})
