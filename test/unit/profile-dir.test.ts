import * as assert from 'node:assert/strict'
import { activeProfileDir } from '../../src/mcp/registration'

describe('activeProfileDir', () => {
  it('reads the profile id from a named profile storage path', () => {
    assert.equal(
      activeProfileDir('C:/Users/x/AppData/Roaming/Code/User/profiles/-abc12/globalStorage/smoochy.better-codebase-memory-mcp'),
      '-abc12',
    )
  })

  it('returns undefined on the default profile', () => {
    assert.equal(
      activeProfileDir('/home/x/.config/Code/User/globalStorage/smoochy.better-codebase-memory-mcp'),
      undefined,
    )
  })

  it('accepts backslash separators', () => {
    assert.equal(
      activeProfileDir('C:\\Users\\x\\AppData\\Roaming\\Code\\User\\profiles\\p1\\globalStorage\\ext'),
      'p1',
    )
  })
})
