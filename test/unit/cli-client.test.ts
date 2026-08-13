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
      {
        name: 'a',
        root_path: 'D:/a',
        branch: null,
        nodes: undefined,
        edges: undefined,
        size_bytes: undefined,
      },
    ])
  })

  // The branch moved out of a `git` object and became a flat field in CLI
  // 0.10.0, and the extension has no say in which binary it talks to: an
  // external path can name either. Reading only one shape lost the branch tag
  // without an error anywhere, which is the failure these cover.
  for (const [label, entry, expected] of [
    ['the flat 0.10.x field', '"branch":"main"', 'main'],
    ['the nested 0.9.x object', '"git":{"branch":"main"}', 'main'],
    ['neither shape', '"nodes":1', null],
    ['a null flat branch, on a detached head', '"branch":null', null],
    ['a null nested branch', '"git":{"branch":null}', null],
    ['an empty branch string', '"branch":""', null],
    ['a non-string branch', '"branch":7', null],
  ] as const) {
    it(`reads the branch from ${label}`, async () => {
      const stdout = `{"projects":[{"name":"a","root_path":"D:/a",${entry}}]}`
      const result = await new CliClient(BIN, stubRunner({ stdout })).listProjects()
      assert.equal(result.ok && result.value[0]?.branch, expected)
    })
  }

  // Both shapes present at once is not a payload any measured binary produces.
  // It is here so the preference is stated rather than incidental: the flat
  // field is the current one.
  it('prefers the flat branch when a payload carries both', async () => {
    const stdout = '{"projects":[{"name":"a","root_path":"D:/a","branch":"new","git":{"branch":"old"}}]}'
    const result = await new CliClient(BIN, stubRunner({ stdout })).listProjects()
    assert.equal(result.ok && result.value[0]?.branch, 'new')
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
      {
        name: 'a',
        root_path: '/a',
        branch: null,
        nodes: undefined,
        edges: undefined,
        size_bytes: undefined,
      },
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
    const result = await client.listProjects()
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

  // Measured stderr of `config get nope` on 0.10.2: the real cause arrives
  // behind a routine log line the CLI writes on every run, successful ones
  // included, so quoting stderr raw put the noise first.
  it('drops the routine log line from a config failure', async () => {
    const stderr = [
      'level=info msg=version_cohort.claimed_unheld build=f122276',
      'error: unknown config key: nope',
      'Known keys: auto_index auto_index_limit auto_watch ui-lang',
    ].join('\n')
    const client = new CliClient(BIN, stubRunner({ stdout: '', stderr, code: 1 }))
    const result = await client.configText(['get', 'nope'])
    assert.equal(result.ok, false)
    const error = result.ok ? '' : result.error
    assert.ok(error.startsWith('error: unknown config key: nope'))
    assert.doesNotMatch(error, /version_cohort/)
    assert.match(error, /Known keys:/)
  })

  it('falls back to the exit code when stderr carries nothing but log lines', async () => {
    const stderr = 'level=info msg=mem.init budget_mb=512'
    const client = new CliClient(BIN, stubRunner({ stdout: '', stderr, code: 1 }))
    const result = await client.configText(['get', 'nope'])
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /config exited with 1/)
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
