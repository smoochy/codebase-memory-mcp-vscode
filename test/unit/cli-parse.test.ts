import * as assert from 'node:assert/strict'
import { extractJson, logLines } from '../../src/cli/parse'

describe('extractJson', () => {
  it('skips a leading log line', () => {
    const stdout = [
      'level=info msg=mem.init budget_mb=32538 total_ram_mb=65077',
      '{"projects":[{"name":"D-Hold-VS-Code","nodes":19768}]}',
    ].join('\n')
    const result = extractJson<{ projects: { name: string; nodes: number }[] }>(stdout)
    assert.ok(result.ok)
    assert.equal(result.value.projects[0]?.name, 'D-Hold-VS-Code')
    assert.equal(result.value.projects[0]?.nodes, 19768)
  })

  it('skips several log lines and trailing whitespace', () => {
    const stdout = 'level=info msg=a\nlevel=warn msg=b\n{"ok":1}\n\n'
    const result = extractJson<{ ok: number }>(stdout)
    assert.ok(result.ok)
    assert.equal(result.value.ok, 1)
  })

  it('reports an error object as a failure even though the CLI exits 0', () => {
    const stdout =
      '{"error":"missing required argument: project","hint":"Pass the project as the argument"}'
    const result = extractJson(stdout)
    assert.ok(!result.ok)
    assert.equal(result.error, 'missing required argument: project')
    assert.equal(result.hint, 'Pass the project as the argument')
  })

  it('fails when no JSON line is present', () => {
    const result = extractJson('level=info msg=mem.init\nsomething went wrong\n')
    assert.ok(!result.ok)
    assert.match(result.error, /no JSON/i)
  })

  it('takes the last JSON line when several are present', () => {
    const result = extractJson<{ n: number }>('{"n":1}\nlevel=info msg=x\n{"n":2}')
    assert.ok(result.ok)
    assert.equal(result.value.n, 2)
  })

  it('fails on malformed JSON rather than throwing', () => {
    const result = extractJson('{"n":')
    assert.ok(!result.ok)
    assert.match(result.error, /parse/i)
  })

  it('returns the log lines separately', () => {
    const stdout = 'level=info msg=a\n{"ok":1}\nlevel=info msg=b'
    assert.deepEqual(logLines(stdout), ['level=info msg=a', 'level=info msg=b'])
  })
})
