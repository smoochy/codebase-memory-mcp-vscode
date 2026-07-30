import * as assert from 'node:assert/strict'
import { wizardSteps, WIZARD_STEP_IDS, type WizardStep } from '../../src/setup/wizard'
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
    const byId = new Map<string, WizardStep>()
    // Sweep every reachable state combination so each WizardStepId is hit at least once,
    // rather than reading text off one state's output (which only covers 5 of the ids).
    for (const source of ['auto', 'managed', 'external'] as const) {
      for (const managedPath of [null, MANAGED]) {
        for (const externalPath of [null, EXTERNAL]) {
          for (const registration of [
            { kind: 'missing' as const },
            { kind: 'present' as const, path: MANAGED },
            { kind: 'present' as const, path: '/other/path' },
            { kind: 'unknown' as const },
          ]) {
            for (const hasProjects of [false, true]) {
              const s = state({ source, managedPath, externalPath, registration })
              for (const step of wizardSteps(s, hasProjects)) {
                byId.set(step.id, step)
              }
            }
          }
        }
      }
    }

    for (const id of WIZARD_STEP_IDS) {
      const step = byId.get(id)
      assert.ok(step, `no reachable state produced step '${id}'`)
      assert.ok(step.title.length > 0, `'${id}' has an empty title`)
      assert.ok(step.detail.length > 0, `'${id}' has an empty detail`)
    }
  })

  it('emits resolve-path-conflict instead of done when the registered path disagrees, even with projects', () => {
    const s = state({
      source: 'managed',
      managedPath: MANAGED,
      registration: { kind: 'present', path: '/other/path' },
    })
    assert.deepEqual(ids(s, true), ['resolve-path-conflict'])
  })

  it('puts resolve-path-conflict before add-projects, since a wrong entry makes indexing point at the wrong store', () => {
    const s = state({
      source: 'managed',
      managedPath: MANAGED,
      registration: { kind: 'present', path: '/other/path' },
    })
    assert.deepEqual(ids(s, false), ['resolve-path-conflict', 'add-projects'])
  })

  it('leaves a conflict-free state unaffected', () => {
    const s = state({
      source: 'managed',
      managedPath: MANAGED,
      registration: { kind: 'present', path: MANAGED },
    })
    assert.deepEqual(ids(s, true), ['done'])
    assert.deepEqual(ids(s, false), ['add-projects'])
  })
})
