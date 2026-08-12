import * as assert from 'node:assert/strict'
import { wizardSteps, wizardStepTitle, WIZARD_STEP_IDS, type WizardStep } from '../../src/setup/wizard'
import { computeState, type StateInput } from '../../src/state/machine'

const MANAGED = 'C:/storage/bin/cmm.exe'
const EXTERNAL = '/usr/bin/cmm'
const state = (over: Partial<StateInput>) =>
  computeState({
    source: 'auto',
    managedPath: null,
    externalPath: null,
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

  // The server is provided in memory once a binary resolves, so a present
  // binary has no registration step left to take.
  it('skips setup entirely once a binary is present', () => {
    const s = state({ source: 'managed', managedPath: MANAGED })
    assert.deepEqual(ids(s, false), ['add-projects'])
  })

  it('asks nothing of an external binary beyond the projects', () => {
    const s = state({ source: 'external', externalPath: EXTERNAL })
    assert.deepEqual(ids(s, false), ['add-projects'])
  })

  it('reports done when everything is in place', () => {
    assert.deepEqual(ids(state({ source: 'managed', managedPath: MANAGED }), true), ['done'])
  })

  it('gives every step a title and a detail, so no step renders blank', () => {
    const byId = new Map<string, WizardStep>()
    // Sweep every reachable state combination so each WizardStepId is hit at
    // least once, rather than reading text off one state's output.
    for (const source of ['auto', 'managed', 'external'] as const) {
      for (const managedPath of [null, MANAGED]) {
        for (const externalPath of [null, EXTERNAL]) {
          for (const hasProjects of [false, true]) {
            for (const step of wizardSteps(state({ source, managedPath, externalPath }), hasProjects)) {
              byId.set(step.id, step)
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

  it('wizardStepTitle agrees with the title wizardSteps computes for the same id', () => {
    for (const step of wizardSteps(state({}), false)) {
      assert.equal(wizardStepTitle(step.id), step.title)
    }
  })
})
