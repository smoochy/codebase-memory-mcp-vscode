import { extractJson, normalizeProjectPath, type CliResult } from './parse'

export interface RunOutput {
  stdout: string
  stderr: string
  code: number | null
}

export type Runner = (command: string, args: string[], timeoutMs: number) => Promise<RunOutput>

export interface ProjectSummary {
  name: string
  path: string
  files?: number
  symbols?: number
}

export interface IndexStatus {
  indexing: boolean
  progress?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

/** Thin wrapper around the CLI. All calls are read-only except add and remove. */
export class CliClient {
  constructor(
    private readonly binaryPath: string,
    private readonly run: Runner,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  private async json<T>(args: string[]): Promise<CliResult<T>> {
    let output: RunOutput
    try {
      output = await this.run(this.binaryPath, args, this.timeoutMs)
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }

    const parsed = extractJson<T>(output.stdout)
    if (parsed.ok) {
      return parsed
    }

    // No JSON came back, so fall back to whatever the process reported.
    if (output.code !== 0) {
      const detail = output.stderr.trim() || parsed.error
      return { ok: false, error: `CLI exited with ${String(output.code)}: ${detail}` }
    }
    return parsed
  }

  async listProjects(): Promise<CliResult<ProjectSummary[]>> {
    const result = await this.json<{ projects?: ProjectSummary[] }>([
      'cli',
      'list_projects',
      '--json',
    ])
    if (!result.ok) {
      return result
    }
    return { ok: true, value: result.value.projects ?? [] }
  }

  async indexStatus(project: string): Promise<CliResult<IndexStatus>> {
    return this.json<IndexStatus>(['cli', 'index_status', '--project', project, '--json'])
  }

  async addProject(path: string): Promise<CliResult<unknown>> {
    return this.json<unknown>([
      'cli',
      'index_repository',
      '--path',
      normalizeProjectPath(path),
      '--json',
    ])
  }

  async removeProject(name: string): Promise<CliResult<unknown>> {
    return this.json<unknown>(['cli', 'delete_project', '--project', name, '--json'])
  }

  async version(): Promise<CliResult<string>> {
    try {
      const output = await this.run(this.binaryPath, ['--version'], this.timeoutMs)
      const match = /\d+\.\d+\.\d+/.exec(output.stdout)
      return match === null
        ? { ok: false, error: 'could not read version from CLI output' }
        : { ok: true, value: match[0] }
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}
