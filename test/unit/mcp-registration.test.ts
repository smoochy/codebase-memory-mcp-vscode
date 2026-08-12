import * as assert from 'node:assert/strict'
import {
  mcpConfigCandidates,
  stripJsonComments,
  withoutMcpEntry,
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


describe('withoutMcpEntry', () => {
  const parse = (text: string): Record<string, any> => JSON.parse(text) as Record<string, any>

  it('removes our own entry and leaves every other server in place', () => {
    const before =
      '{"inputs":[1],"servers":{"other":{"command":"x"},"codebase-memory-mcp":{"command":"/bin/cmm"}}}'
    const after = parse(withoutMcpEntry(before) as string)
    assert.deepEqual(Object.keys(after['servers']), ['other'])
    assert.deepEqual(after['inputs'], [1])
  })

  it('removes the alternative key older installs wrote', () => {
    const after = parse(
      withoutMcpEntry('{"mcpServers":{"codebase-memory":{"command":"/usr/bin/cmm"}}}') as string,
    )
    assert.deepEqual(after['mcpServers'], {})
  })

  it('reports nothing to do when no entry of ours is there', () => {
    assert.equal(withoutMcpEntry('{"servers":{"other":{"command":"x"}}}'), null)
    assert.equal(withoutMcpEntry('{}'), null)
    assert.equal(withoutMcpEntry(''), null)
    assert.equal(withoutMcpEntry(null), null)
  })

  // A file we cannot read is one we must not flatten: refusing leaves the
  // user's own comments and servers intact, and the provider serves VS Code
  // either way.
  it('refuses to rewrite a file it cannot parse', () => {
    assert.equal(withoutMcpEntry('{ not json'), null)
  })

  it('tolerates the comments VS Code allows in mcp.json', () => {
    const after = parse(
      withoutMcpEntry(
        '{\n// mine\n"servers":{"codebase-memory-mcp":{"command":"/usr/bin/cmm"}}}',
      ) as string,
    )
    assert.deepEqual(after['servers'], {})
  })
})
