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
      '{"projects":[{"name":"a","path":"D:/a"}]}\n'
    const client = new CliClient(BIN, stubRunner({ stdout }))
    const result = await client.listProjects()
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok ? result.value : null, [{ name: 'a', path: 'D:/a' }])
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
    assert.ok(calls[0]?.args.includes('D:/Repos/App'))
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
