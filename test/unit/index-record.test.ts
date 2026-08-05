import * as assert from 'node:assert/strict'
import { advanceIndexRecord, type IndexRecord } from '../../src/state/indexRecord'

const HEAD = 'a'.repeat(40)
const OLD = 'b'.repeat(40)

describe('advanceIndexRecord', () => {
  it('claims nothing for a project the extension never indexed', () => {
    assert.equal(advanceIndexRecord(undefined, HEAD, 5_000), undefined)
  })

  it('fills in the commit for a project added before its name was known', () => {
    const record: IndexRecord = { sha: null, at: 1_000 }
    assert.deepEqual(advanceIndexRecord(record, HEAD, undefined), { sha: HEAD, at: 1_000 })
  })

  it('adopts the current commit when the store was rebuilt outside the panel', () => {
    // The CLI and the MCP tool write the store without touching the note, so a
    // newer store file is the only signal that a reindex happened at all.
    const record: IndexRecord = { sha: OLD, at: 1_000 }
    assert.deepEqual(advanceIndexRecord(record, HEAD, 2_000), { sha: HEAD, at: 2_000 })
  })

  it('keeps the note when the store predates it, so a moved checkout stays outdated', () => {
    const record: IndexRecord = { sha: OLD, at: 2_000 }
    assert.equal(advanceIndexRecord(record, HEAD, 1_000), record)
  })

  it('keeps the note when the store file is missing', () => {
    const record: IndexRecord = { sha: OLD, at: 2_000 }
    assert.equal(advanceIndexRecord(record, HEAD, undefined), record)
  })

  it('returns the same object when nothing moved, so no write is triggered', () => {
    const record: IndexRecord = { sha: HEAD, at: 2_000 }
    assert.equal(advanceIndexRecord(record, HEAD, 2_000), record)
  })
})
