import * as assert from 'node:assert/strict'
import {
  mcpConfigCandidates,
  mentionsOurServer,
  stripJsonComments,
  userConfigRoot,
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

  // The CLI's install writes into every profile, so cleaning only the running
  // one leaves the rest syncing an absolute path to a machine it cannot start
  // on. Sorted so the order does not depend on the directory listing.
  it('names every named profile beside the default one', () => {
    assert.deepEqual(
      mcpConfigCandidates(`C:/Users/x/AppData/Roaming/Code/User/globalStorage/${extension}`, [
        'builtin',
        '-24ba6aba',
      ]),
      [
        'C:/Users/x/AppData/Roaming/Code/User/mcp.json',
        'C:/Users/x/AppData/Roaming/Code/User/profiles/-24ba6aba/mcp.json',
        'C:/Users/x/AppData/Roaming/Code/User/profiles/builtin/mcp.json',
      ],
    )
  })

  // Running inside a named profile has to reach the same tree as running in
  // the default one, or nine files stay behind whenever the user happens to
  // start VS Code in a profile.
  it('steps out of a named profile to reach the same root', () => {
    assert.deepEqual(
      mcpConfigCandidates(
        `/home/x/.config/Code/User/profiles/-abc123/globalStorage/${extension}`,
        ['-abc123'],
      ),
      [
        '/home/x/.config/Code/User/mcp.json',
        '/home/x/.config/Code/User/profiles/-abc123/mcp.json',
      ],
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
    assert.equal(userConfigRoot('/somewhere/else'), null)
  })
})

describe('mentionsOurServer', () => {
  it('tells an unparsable file that holds our entry from one that does not', () => {
    assert.equal(mentionsOurServer('{ not json "codebase-memory-mcp": {}'), true)
    assert.equal(mentionsOurServer('{ not json "other": {}'), false)
    assert.equal(mentionsOurServer(null), false)
  })

  // The key, not the substring: a command path ending in the binary's name is
  // every managed install, and warning about those would be noise on files
  // holding nothing of ours.
  it('does not match the binary path alone', () => {
    assert.equal(mentionsOurServer('{"servers":{"x":{"command":"/bin/codebase-memory-mcp"}}}'), false)
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
