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
    assert.deepEqual(result.ok ? result.value : null, [
      { name: 'a', root_path: 'D:/a', nodes: undefined, edges: undefined, size_bytes: undefined },
    ])
  })

  // Each of these reached the panel and threw there before listProjects
  // validated the shape - inside the refresh timer, which has no handler, so
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

  it('drops counts that are not finite numbers, which would throw on render', async () => {
    // Both summing and formatting force ToPrimitive, so an object here throws
    // inside the refresh timer and the panel stops updating for good.
    const stdout =
      '{"projects":[{"name":"a","root_path":"/a","nodes":{"toString":1,"valueOf":1},' +
      '"edges":"lots","size_bytes":null}]}'
    const client = new CliClient(BIN, stubRunner({ stdout }))
    const result = await client.listProjects()
    assert.ok(result.ok)
    assert.deepEqual(result.value, [
      { name: 'a', root_path: '/a', nodes: undefined, edges: undefined, size_bytes: undefined },
    ])
  })

  it('keeps counts that are real numbers', async () => {
    const stdout = '{"projects":[{"name":"a","root_path":"/a","nodes":5,"edges":7,"size_bytes":9}]}'
    const client = new CliClient(BIN, stubRunner({ stdout }))
    const result = await client.listProjects()
    assert.ok(result.ok)
    assert.equal(result.value[0]?.nodes, 5)
    assert.equal(result.value[0]?.edges, 7)
    assert.equal(result.value[0]?.size_bytes, 9)
  })

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
    assert.ok(calls[0]?.args.includes('--repo-path=D:/Repos/App'))
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
    assert.deepEqual(calls[0]?.args, ['cli', 'index_repository', '--repo-path=--exclude=x', '--json'])
  })

  // The value of a setting is not validated anywhere - it comes straight from
  // a webview field. It stays harmless because it is its own argv element and
  // spawn runs without a shell, which is exactly what this pins.
  it('passes a setting value as one argv element, whatever is in it', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const hostile = '"; rm -rf ~ #'
    await new CliClient(BIN, stubRunner({ stdout: '' }, calls)).setConfig('auto_watch', hostile)
    assert.deepEqual(calls[0]?.args, ['config', 'set', 'auto_watch', hostile])
  })

  it('reports a non-zero exit from a config write rather than silently passing', async () => {
    const client = new CliClient(BIN, stubRunner({ stdout: '', stderr: 'unknown key', code: 1 }))
    const result = await client.setConfig('nope', 'x')
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /unknown key/)
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

  it('does not quote the CLI\'s routine info logging as the cause of a failure', async () => {
    const stderr = 'level=info msg=mem.init budget_mb=32538 total_ram_mb=65077'
    const client = new CliClient(BIN, stubRunner({ stdout: '', stderr, code: 1 }))
    const result = await client.listProjects()
    assert.equal(result.ok, false)
    assert.doesNotMatch(result.ok ? '' : result.error, /mem\.init/)
    assert.match(result.ok ? '' : result.error, /CLI exited with 1:/)
  })

  it('keeps a real stderr error that arrives beside the routine info logging', async () => {
    const stderr = 'level=info msg=mem.init budget_mb=32538\nlevel=error msg=store locked'
    const client = new CliClient(BIN, stubRunner({ stdout: '', stderr, code: 1 }))
    const result = await client.listProjects()
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /store locked/)
    assert.doesNotMatch(result.ok ? '' : result.error, /mem\.init/)
  })

  it('falls back to stdout when the only stderr is routine logging', async () => {
    const stderr = 'level=info msg=mem.init budget_mb=32538'
    const client = new CliClient(BIN, stubRunner({ stdout: 'panic: nil map', stderr, code: 2 }))
    const result = await client.listProjects()
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /panic: nil map/)
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
