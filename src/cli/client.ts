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
 * name - which is precisely the bug this shape replaced.
 */
export interface ProjectSummary {
  name: string
  root_path: string
  nodes?: number
  edges?: number
  size_bytes?: number
  /** Present for git checkouts; `branch` is null on a detached or non-git root. */
  git?: {
    branch?: string | null
    /**
     * Written when the project is first added and never advanced afterwards -
     * measured against the real CLI, a reindex leaves it untouched. It is
     * therefore NOT the commit the current index was built from; the extension
     * records that itself. Kept only because the CLI reports it.
     */
    base_sha?: string | null
    /** Commit the working tree is on now. */
    head_sha?: string | null
  }
  /**
   * Filled in by the extension, not the CLI: when this extension last indexed
   * the project, falling back to the mtime of the per-project store file for
   * projects it has not indexed itself yet.
   */
  indexed_at_ms?: number
  /**
   * Filled in by the extension: the checkout has moved to another commit since
   * the index was built. Absent when the extension has never indexed this
   * project and so has nothing to compare against.
   */
  stale?: boolean
  /** Files changed since the index was built, from `detect_changes`. */
  changed_count?: number
}

export interface IndexStatus {
  indexing: boolean
  progress?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

/** Keep a count only when it is a real number; anything else becomes absent. */
function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Whatever on stderr could be the reason a run failed, with the CLI's routine
 * logging dropped.
 *
 * The CLI writes `level=info msg=mem.init ...` to stderr on every run, a
 * successful one included, so treating "stderr is non-empty" as the cause
 * quoted that line back as the explanation for an exit code it has nothing to
 * do with - a symptom and no cause. Only `warn` and `error` lines, and any
 * output that is not logfmt at all, can carry a reason.
 */
export function stderrCause(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !/^level=(?:info|debug|trace)\b/.test(line.trim()))
    .join('\n')
    .trim()
}

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
      // A parsed payload - success or the CLI's own structured error - is the
      // failure signal, not the exit code (spec, appendix A).
      return parsed
    }

    // No usable JSON came back, so fall back to whatever the process reported.
    if (output.code !== 0) {
      const detail = stderrCause(output.stderr) || output.stdout.trim() || parsed.error
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
    // the panel and throw there - inside a refresh timer with no handler,
    // which takes the panel down on every tick rather than once.
    const projects = (result.value as { projects?: unknown } | null)?.projects
    if (!Array.isArray(projects)) {
      return { ok: true, value: [] }
    }
    return {
      ok: true,
      value: projects
        .filter(
          (entry): entry is ProjectSummary =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as ProjectSummary).name === 'string' &&
            typeof (entry as ProjectSummary).root_path === 'string',
        )
        // The counts are summed and formatted without further checks, and both
        // operations force ToPrimitive. A non-number there throws during the
        // render, inside the same unhandled refresh timer - so drop anything
        // that is not a finite number here rather than at each use.
        .map((entry) => ({
          ...entry,
          nodes: finiteOrUndefined(entry.nodes),
          edges: finiteOrUndefined(entry.edges),
          size_bytes: finiteOrUndefined(entry.size_bytes),
        })),
    }
  }

  async indexStatus(project: string): Promise<CliResult<IndexStatus>> {
    return this.json<IndexStatus>(['cli', 'index_status', `--project=${project}`, '--json'])
  }

  async addProject(path: string): Promise<CliResult<unknown>> {
    // `--repo-path`, not `--path`: the tool's parameter is `repo_path`, and an
    // unknown flag is ignored rather than rejected, so `--path` silently made
    // the CLI index its own working directory instead of the chosen folder.
    return this.json<unknown>([
      'cli',
      'index_repository',
      `--repo-path=${normalizeProjectPath(path)}`,
      '--json',
    ])
  }

  async removeProject(name: string): Promise<CliResult<unknown>> {
    return this.json<unknown>(['cli', 'delete_project', `--project=${name}`, '--json'])
  }

  /** Raw stdout of a `config` subcommand, which is plain text, not JSON. */
  async configText(args: string[]): Promise<CliResult<string>> {
    try {
      const output = await this.run(this.binaryPath, ['config', ...args], this.timeoutMs)
      if (output.code !== 0) {
        return { ok: false, error: output.stderr.trim() || `config exited with ${String(output.code)}` }
      }
      return { ok: true, value: output.stdout }
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  /**
   * Write one setting.
   *
   * Key and value are separate argv elements the CLI expects positionally, and
   * spawn runs without a shell, so neither can be reinterpreted.
   */
  async setConfig(key: string, value: string): Promise<CliResult<string>> {
    return this.configText(['set', key, value])
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
