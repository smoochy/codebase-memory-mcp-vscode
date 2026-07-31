import { extractJson, normalizeProjectPath, type CliResult } from './parse'

export interface RunOutput {
  stdout: string
  stderr: string
  code: number | null
}

export type Runner = (command: string, args: string[], timeoutMs: number) => Promise<RunOutput>

/**
 * One indexed repository, as the CLI reports it.
 *
 * Field names mirror `cli list_projects --json` exactly, including the
 * snake_case `root_path` and `size_bytes`. Renaming them here would mean a
 * translation step that silently yields `undefined` the day the CLI changes a
 * name — which is precisely the bug this shape replaced.
 */
export interface ProjectSummary {
  name: string
  root_path: string
  nodes?: number
  edges?: number
  size_bytes?: number
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
    if (parsed.ok || parsed.structured) {
      // A parsed payload — success or the CLI's own structured error — is the
      // failure signal, not the exit code (spec, appendix A).
      return parsed
    }

    // No usable JSON came back, so fall back to whatever the process reported.
    if (output.code !== 0) {
      const detail = output.stderr.trim() || parsed.error
      return { ok: false, error: `CLI exited with ${String(output.code)}: ${detail}` }
    }
    return parsed
  }

  async listProjects(): Promise<CliResult<ProjectSummary[]>> {
    const result = await this.json<unknown>(['cli', 'list_projects', '--json'])
    if (!result.ok) {
      return result
    }
    // This is the one place the untyped CLI payload becomes a typed domain
    // object, so it is the one place the shape has to be checked. `.projects`
    // being null, a string, an object, or an array of nulls all used to reach
    // the panel and throw there — inside a refresh timer with no handler,
    // which takes the panel down on every tick rather than once.
    const projects = (result.value as { projects?: unknown } | null)?.projects
    if (!Array.isArray(projects)) {
      return { ok: true, value: [] }
    }
    return {
      ok: true,
      value: projects.filter(
        (entry): entry is ProjectSummary =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as ProjectSummary).name === 'string' &&
          typeof (entry as ProjectSummary).root_path === 'string',
      ),
    }
  }

  async indexStatus(project: string): Promise<CliResult<IndexStatus>> {
    return this.json<IndexStatus>(['cli', 'index_status', `--project=${project}`, '--json'])
  }

  async addProject(path: string): Promise<CliResult<unknown>> {
    return this.json<unknown>([
      'cli',
      'index_repository',
      `--path=${normalizeProjectPath(path)}`,
      '--json',
    ])
  }

  async removeProject(name: string): Promise<CliResult<unknown>> {
    return this.json<unknown>(['cli', 'delete_project', `--project=${name}`, '--json'])
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
