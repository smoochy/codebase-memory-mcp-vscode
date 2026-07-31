import * as assert from 'node:assert/strict'
import { CliClient, type Runner } from '../../src/cli/client'

/** Runner stub that records the invocation and replays a fixed result. */
function stubRunner(
  output: Partial<{ stdout: string; stderr: string; code: number | null }>,
  calls: Array<{ command: string; args: string[] }> = [],
): Runner {
  return async (command, args) => {
    calls.push({ command, args })
    return { stdout: '', stderr: '', code: 0, ...output }
  }
}

const BIN = 'C:/bin/cmm.exe'

describe('CliClient', () => {
  it('parses the project list past the log preamble', async () => {
    const stdout =
      'level=info msg=mem.init budget_mb=32538 total_ram_mb=65077\n' +
      '{"projects":[{"name":"a","root_path":"D:/a"}]}\n'
    const client = new CliClient(BIN, stubRunner({ stdout }))
    const result = await client.listProjects()
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok ? result.value : null, [{ name: 'a', root_path: 'D:/a' }])
  })

  // Each of these reached the panel and threw there before listProjects
  // validated the shape — inside the refresh timer, which has no handler, so
  // the panel broke on every tick rather than once.
  for (const [label, payload] of [
    ['a null payload', '{"structuredContent":null}'],
    ['a non-array projects field', '{"projects":{}}'],
    ['a string projects field', '{"projects":"abc"}'],
    ['null entries', '{"projects":[null]}'],
    ['entries missing root_path', '{"projects":[{"name":"a"}]}'],
    ['an unstringifiable name', '{"projects":[{"name":{"toString":1,"valueOf":1}}]}'],
  ] as const) {
    it(`survives ${label} without throwing`, async () => {
      const client = new CliClient(BIN, stubRunner({ stdout: payload }))
      const result = await client.listProjects()
      assert.equal(result.ok, true)
      assert.deepEqual(result.ok ? result.value : null, [])
    })
  }

  it('returns an empty list when the CLI reports no projects', async () => {
    const client = new CliClient(BIN, stubRunner({ stdout: '{"projects":[]}' }))
    const result = await client.listProjects()
    assert.deepEqual(result.ok ? result.value : null, [])
  })

  it('treats an error object as a failure even at exit code zero', async () => {
    const stdout = '{"error":"project required","hint":"pass --project"}'
    const client = new CliClient(BIN, stubRunner({ stdout, code: 0 }))
    const result = await client.indexStatus('a')
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /project required/)
  })

  it('reports a non-zero exit with no JSON using stderr', async () => {
    const client = new CliClient(BIN, stubRunner({ stdout: '', stderr: 'boom', code: 1 }))
    const result = await client.listProjects()
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /boom/)
  })

  it('reports a crash with neither output nor exit code', async () => {
    const client = new CliClient(BIN, stubRunner({ stdout: '', stderr: '', code: null }))
    const result = await client.listProjects()
    assert.equal(result.ok, false)
  })

  it('passes the binary path and subcommand through unchanged', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    await new CliClient(BIN, stubRunner({ stdout: '{"projects":[]}' }, calls)).listProjects()
    assert.equal(calls[0]?.command, BIN)
    assert.deepEqual(calls[0]?.args, ['cli', 'list_projects', '--json'])
  })

  it('normalizes a Windows path before adding a project', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    await new CliClient(BIN, stubRunner({ stdout: '{}' }, calls)).addProject('d:\\Repos\\App')
    assert.ok(calls[0]?.args.includes('--path=D:/Repos/App'))
  })

  // A project name comes from the CLI's own JSON, which is filled from indexed
  // repositories. Passed as a separate argv element, a name starting with `--`
  // would be read by the CLI's flag parser as an option of its own. Binding the
  // value to its flag with `=` keeps it a value whatever the name looks like.
  it('binds a project name to its flag so a --name cannot become a flag', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const client = new CliClient(BIN, stubRunner({ stdout: '{}' }, calls))
    await client.removeProject('--config=/tmp/evil')
    assert.deepEqual(calls[0]?.args, [
      'cli',
      'delete_project',
      '--project=--config=/tmp/evil',
      '--json',
    ])
    assert.ok(!calls[0]?.args.includes('--config=/tmp/evil'))
  })

  it('binds the index_status project the same way', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    await new CliClient(BIN, stubRunner({ stdout: '{}' }, calls)).indexStatus('--help')
    assert.deepEqual(calls[0]?.args, ['cli', 'index_status', '--project=--help', '--json'])
  })

  it('binds a path that looks like a flag when adding a project', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    await new CliClient(BIN, stubRunner({ stdout: '{}' }, calls)).addProject('--exclude=x')
    assert.deepEqual(calls[0]?.args, ['cli', 'index_repository', '--path=--exclude=x', '--json'])
  })

  it('prefers the structured CLI error over stderr when both are present', async () => {
    const stdout = '{"error":"project required","hint":"pass --project"}'
    const client = new CliClient(BIN, stubRunner({ stdout, stderr: 'boom', code: 1 }))
    const result = await client.listProjects()
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /project required/)
    assert.doesNotMatch(result.ok ? '' : result.error, /boom/)
    assert.doesNotMatch(result.ok ? '' : result.error, /CLI exited with/)
  })

  it('carries the hint through from a structured CLI error at non-zero exit', async () => {
    const stdout = '{"error":"project required","hint":"pass --project"}'
    const client = new CliClient(BIN, stubRunner({ stdout, stderr: 'boom', code: 1 }))
    const result = await client.listProjects()
    assert.equal(result.ok, false)
    assert.equal(result.ok ? undefined : result.hint, 'pass --project')
  })

  it('falls back to the exit-code path for malformed JSON rather than treating it as structured', async () => {
    const client = new CliClient(BIN, stubRunner({ stdout: '{not json', stderr: 'boom', code: 1 }))
    const result = await client.listProjects()
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /CLI exited with 1: boom/)
  })

  it('surfaces a runner rejection as a failed result rather than throwing', async () => {
    const failing: Runner = async () => {
      throw new Error('ENOENT')
    }
    const result = await new CliClient(BIN, failing).listProjects()
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /ENOENT/)
  })
})
