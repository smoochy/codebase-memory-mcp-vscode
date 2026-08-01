import * as assert from 'node:assert/strict'
import {
  mergeSettings,
  optionsFromDescription,
  parseConfigKeys,
  parseConfigList,
} from '../../src/cli/configParse'

const CONFIG_OUTPUT = [
  'Usage: codebase-memory-mcp config <command> [args]',
  '',
  'Commands:',
  '  list             Show all config values',
  '  get <key>        Get a config value',
  '  set <key> <val>  Set a config value',
  '  reset <key>      Reset a key to default',
  '',
  'Config keys:',
  '  auto_index                 default=false       Enable auto-indexing on MCP session start',
  '  auto_index_limit           default=50000       Max files for auto-indexing new projects',
  '  auto_watch                 default=true        Register background git watcher on session connect',
  '  ui-lang                    default=auto        Pin graph UI language: en, zh, or auto',
].join('\n')

const LIST_OUTPUT = [
  'Configuration:',
  '  auto_index                = false     ',
  '  auto_index_limit          = 50000     ',
  '  auto_watch                = true      ',
  '  ui-lang                   = auto      ',
].join('\n')

describe('parseConfigKeys', () => {
  it('reads only the entries below "Config keys:"', () => {
    const keys = parseConfigKeys(CONFIG_OUTPUT)
    assert.equal(keys.size, 4)
    assert.equal(keys.get('auto_watch')?.default, 'true')
    assert.equal(
      keys.get('auto_watch')?.description,
      'Register background git watcher on session connect',
    )
  })

  it('does not mistake the command list for config keys', () => {
    const keys = parseConfigKeys(CONFIG_OUTPUT)
    assert.equal(keys.has('list'), false)
    assert.equal(keys.has('get'), false)
  })

  it('returns an empty map when the section is missing', () => {
    assert.equal(parseConfigKeys('Usage: something else').size, 0)
  })
})

describe('optionsFromDescription', () => {
  // The CLI has no machine-readable schema but names the choices in prose, so
  // a picker can be built without hardcoding upstream's keys here.
  it('reads the choices out of the CLI description', () => {
    assert.deepEqual(optionsFromDescription('Pin graph UI language: en, zh, or auto'), [
      'en',
      'zh',
      'auto',
    ])
  })

  it('handles a two-way choice', () => {
    assert.deepEqual(optionsFromDescription('Mode: fast or thorough'), ['fast', 'thorough'])
  })

  it('ignores an absurdly long description rather than grinding over it', () => {
    const long = ': a' + (' '.repeat(400) + ', a').repeat(300)
    const started = Date.now()
    assert.deepEqual(optionsFromDescription(long), [])
    assert.ok(Date.now() - started < 100, 'took too long for a description this size')
  })

  for (const prose of [
    'Max files for auto-indexing new projects',
    'Register background git watcher on session connect',
    '',
    'Something with a colon: but no list',
  ]) {
    it(`leaves a free-text setting alone: "${prose}"`, () => {
      assert.deepEqual(optionsFromDescription(prose), [])
    })
  }
})

describe('config key shape', () => {
  // The keys become the allowlist for writes, and a write passes the key as
  // the first positional of `config set`. A key shaped like a flag would make
  // that allowlist meaningless.
  for (const hostile of ['--config-file', '-o', '--']) {
    it(`drops a flag-shaped key from config list: ${hostile}`, () => {
      assert.equal(parseConfigList(`  ${hostile} = 1\n`).size, 0)
    })

    it(`drops a flag-shaped key from the key list: ${hostile}`, () => {
      const stdout = `Config keys:\n  ${hostile}   default=x   Some description\n`
      assert.equal(parseConfigKeys(stdout).size, 0)
    })
  }

  it('keeps the ordinary keys the CLI really uses', () => {
    const parsed = parseConfigList('  auto_index = false\n  ui-lang = auto\n')
    assert.deepEqual([...parsed.keys()], ['auto_index', 'ui-lang'])
  })
})

describe('parseConfigList', () => {
  it('reads key and value, trimming padding', () => {
    const values = parseConfigList(LIST_OUTPUT)
    assert.equal(values.size, 4)
    assert.equal(values.get('auto_index'), 'false')
    assert.equal(values.get('auto_index_limit'), '50000')
    assert.equal(values.get('ui-lang'), 'auto')
  })
})

describe('mergeSettings', () => {
  it('joins values with defaults and descriptions, sorted by key', () => {
    const settings = mergeSettings(
      parseConfigKeys(CONFIG_OUTPUT),
      parseConfigList(LIST_OUTPUT),
    )
    assert.deepEqual(
      settings.map((s) => s.key),
      ['auto_index', 'auto_index_limit', 'auto_watch', 'ui-lang'],
    )
    const watch = settings.find((s) => s.key === 'auto_watch')
    assert.equal(watch?.value, 'true')
    assert.equal(watch?.default, 'true')
  })

  it('keeps a key that only "config list" knows about', () => {
    const settings = mergeSettings(
      new Map(),
      new Map([['brand_new_key', 'somevalue']]),
    )
    assert.equal(settings.length, 1)
    assert.equal(settings[0]?.key, 'brand_new_key')
    assert.equal(settings[0]?.value, 'somevalue')
    assert.equal(settings[0]?.description, '')
  })

  it('falls back to the default when no current value is reported', () => {
    const settings = mergeSettings(
      new Map([['only_documented', { default: 'x', description: 'D' }]]),
      new Map(),
    )
    assert.equal(settings[0]?.value, 'x')
  })
})
