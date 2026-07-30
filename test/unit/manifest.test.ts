import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COMMAND_IDS } from '../../src/commands'

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: {
    commands: Array<{ command: string; title: string }>
    configuration: { properties: Record<string, { type: string; default: unknown }> }
    views: Record<string, Array<{ id: string }>>
  }
  activationEvents: string[]
  dependencies?: Record<string, string>
}

describe('package.json contributions', () => {
  it('declares every command the extension registers', () => {
    const declared = manifest.contributes.commands.map((c) => c.command).sort()
    assert.deepEqual(declared, [...COMMAND_IDS].sort())
  })

  it('declares the settings under the betterCmm prefix', () => {
    const keys = Object.keys(manifest.contributes.configuration.properties)
    assert.ok(keys.length > 0)
    assert.ok(keys.every((k) => k.startsWith('betterCmm.')))
  })

  it('declares binarySource with the three documented values', () => {
    const property = manifest.contributes.configuration.properties['betterCmm.binarySource'] as {
      enum?: string[]
      default?: unknown
    }
    assert.deepEqual(property.enum, ['auto', 'managed', 'external'])
    assert.equal(property.default, 'auto')
  })

  it('defaults autoRefresh to on and refresh interval to a sane value', () => {
    const properties = manifest.contributes.configuration.properties
    assert.equal(properties['betterCmm.autoRefresh']?.default, true)
    assert.equal(properties['betterCmm.refreshIntervalSeconds']?.default, 30)
  })

  it('ships no runtime dependencies', () => {
    assert.deepEqual(manifest.dependencies ?? {}, {})
  })

  it('contributes the panel view', () => {
    const views = Object.values(manifest.contributes.views).flat()
    assert.ok(views.some((v) => v.id === 'betterCmm.panel'))
  })
})
