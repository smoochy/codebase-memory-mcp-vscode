import * as assert from 'node:assert/strict'
import { wizardSteps } from '../../src/setup/wizard'
import { computeState, type StateInput } from '../../src/state/machine'

const MANAGED = 'C:/storage/bin/cmm.exe'
const EXTERNAL = '/usr/bin/cmm'
const state = (over: Partial<StateInput>) =>
  computeState({
    source: 'auto',
    managedPath: null,
    externalPath: null,
    registration: { kind: 'unknown' },
    ...over,
  })
const ids = (...args: Parameters<typeof wizardSteps>) => wizardSteps(...args).map((s) => s.id)

describe('wizardSteps', () => {
  it('starts with the source choice and download when nothing is installed', () => {
    assert.deepEqual(ids(state({}), false), [
      'choose-source',
      'download-binary',
      'verify-binary',
      'register-mcp',
      'add-projects',
    ])
  })

  it('skips the download once a managed binary is present', () => {
    const s = state({ source: 'managed', managedPath: MANAGED, registration: { kind: 'missing' } })
    assert.deepEqual(ids(s, false), ['register-mcp', 'add-projects'])
  })

  it('puts registration before adding projects, since an unregistered server never starts', () => {
    const s = state({ source: 'managed', managedPath: MANAGED, registration: { kind: 'missing' } })
    const steps = ids(s, false)
    assert.ok(steps.indexOf('register-mcp') < steps.indexOf('add-projects'))
  })

  it('offers the clipboard step instead of registration for an external binary', () => {
    const s = state({ source: 'external', externalPath: EXTERNAL, registration: { kind: 'missing' } })
    const steps = ids(s, false)
    assert.ok(steps.includes('copy-install-command'))
    assert.ok(!steps.includes('register-mcp'))
    assert.ok(!steps.includes('download-binary'))
  })

  it('reports done when everything is in place', () => {
    const s = state({
      source: 'managed',
      managedPath: MANAGED,
      registration: { kind: 'present', path: MANAGED },
    })
    assert.deepEqual(ids(s, true), ['done'])
  })

  it('still asks for projects when none are indexed yet', () => {
    const s = state({
      source: 'managed',
      managedPath: MANAGED,
      registration: { kind: 'present', path: MANAGED },
    })
    assert.deepEqual(ids(s, false), ['add-projects'])
  })

  it('gives every step a title and a detail, so no step renders blank', () => {
    for (const step of wizardSteps(state({}), false)) {
      assert.ok(step.title.length > 0)
      assert.ok(step.detail.length > 0)
    }
  })
})
