import * as assert from 'node:assert/strict'
import { extractJson, logLines, normalizeProjectPath } from '../../src/cli/parse'

describe('extractJson', () => {
  // Captured verbatim from `codebase-memory-mcp.exe cli list_projects --json`.
  // Every tool answers in this MCP envelope; the earlier fixtures in this file
  // were hand-written bare payloads, so nothing caught that the real payload
  // sits one level down and `.projects` off the envelope is always undefined.
  const REAL_LIST_OUTPUT =
    'level=info msg=mem.init budget_mb=32538 total_ram_mb=65077\n' +
    '{"content":[{"type":"text","text":"{\\"projects\\":[{\\"name\\":\\"D-Hold-VS-Code\\",' +
    '\\"root_path\\":\\"D:/Hold/VS Code\\",\\"nodes\\":19768,\\"edges\\":53018,' +
    '\\"size_bytes\\":41156608}]}"}],"structuredContent":{"projects":[{"name":"D-Hold-VS-Code",' +
    '"root_path":"D:/Hold/VS Code","nodes":19768,"edges":53018,"size_bytes":41156608}]}}'

  // Captured verbatim from a failing `cli index_repository --json`. Note there
  // is no `error` key: the failure is `status:"error"`, which the original
  // check missed, so a crashed indexing run was reported as a success.
  const REAL_ERROR_OUTPUT =
    'level=info msg=mem.init budget_mb=32538\n' +
    '{"content":[{"type":"text","text":"{\\"status\\":\\"error\\",\\"outcome\\":\\"exit_nonzero\\",' +
    '\\"hint\\":\\"Indexing worker crashed on a file.\\"}"}],"isError":true}'

  it('unwraps the MCP envelope the CLI actually returns', () => {
    const result = extractJson<{
      projects: { name: string; root_path: string; nodes: number }[]
    }>(REAL_LIST_OUTPUT)
    assert.ok(result.ok)
    assert.equal(result.value.projects.length, 1)
    assert.equal(result.value.projects[0]?.name, 'D-Hold-VS-Code')
    assert.equal(result.value.projects[0]?.root_path, 'D:/Hold/VS Code')
    assert.equal(result.value.projects[0]?.nodes, 19768)
  })

  it('reports a status:"error" payload as a failure, not an empty success', () => {
    const result = extractJson<unknown>(REAL_ERROR_OUTPUT)
    assert.equal(result.ok, false)
    assert.ok(!result.ok && result.structured)
    assert.ok(!result.ok && result.error.includes('exit_nonzero'))
    assert.ok(!result.ok && result.hint?.includes('Indexing worker crashed'))
  })

  it('falls back to content[0].text when structuredContent is absent', () => {
    const stdout = '{"content":[{"type":"text","text":"{\\"projects\\":[]}"}]}'
    const result = extractJson<{ projects: unknown[] }>(stdout)
    assert.ok(result.ok)
    assert.deepEqual(result.value.projects, [])
  })

  it('treats an envelope-level isError as a failure', () => {
    const stdout = '{"content":[{"type":"text","text":"{\\"detail\\":\\"nope\\"}"}],"isError":true}'
    const result = extractJson<unknown>(stdout)
    assert.equal(result.ok, false)
  })

  it('still parses a bare payload, for tools that send no envelope', () => {
    const result = extractJson<{ ok: number }>('{"ok":1}')
    assert.ok(result.ok)
    assert.equal(result.value.ok, 1)
  })

  // `String(x)` throws on an object whose toString and valueOf are both
  // non-callable, and JSON.parse produces exactly that from this literal.
  // The throw escaped into the refresh timer, which has no handler.
  const UNSTRINGIFIABLE = '{"toString":1,"valueOf":1}'

  it('does not throw on an error value that cannot be stringified', () => {
    const result = extractJson<unknown>(`{"structuredContent":{"error":${UNSTRINGIFIABLE}}}`)
    assert.equal(result.ok, false)
  })

  it('does not throw on an unstringifiable status:"error" outcome', () => {
    const result = extractJson<unknown>(
      `{"structuredContent":{"status":"error","outcome":${UNSTRINGIFIABLE}}}`,
    )
    assert.equal(result.ok, false)
  })

  it('reports prose output as a failure rather than an empty success', () => {
    const result = extractJson<unknown>('{"content":[{"type":"text","text":"not json at all"}]}')
    assert.equal(result.ok, false)
    assert.ok(!result.ok && result.error.includes('not json at all'))
  })

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

describe('normalizeProjectPath', () => {
  it('uppercases the drive letter and uses forward slashes', () => {
    assert.equal(normalizeProjectPath('d:\\Repos\\App'), 'D:/Repos/App')
  })

  it('leaves a posix path alone', () => {
    assert.equal(normalizeProjectPath('/home/x/app'), '/home/x/app')
  })

  it('leaves an already uppercase drive alone', () => {
    assert.equal(normalizeProjectPath('D:/Repos/App'), 'D:/Repos/App')
  })
})
