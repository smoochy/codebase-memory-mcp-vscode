/** Where the CLI keeps one store file per indexed project. */
export function engineStoreDirectory(home: string): string {
  return `${home.replace(/\\/g, '/')}/.cache/codebase-memory-mcp`
}

/**
 * The store file backing one project.
 *
 * Its modification time is the only record of when the index was last built -
 * the CLI reports counts and git revisions but no timestamp. The `-wal` and
 * `-shm` siblings move on every read, so only the `.db` itself is meaningful.
 */
export function projectStorePath(home: string, projectName: string): string | null {
  // The name comes from CLI output and is interpolated into a path, so a
  // separator or a traversal segment in it would point the lookup somewhere
  // else entirely. Only a plain file-name shape is accepted; anything else
  // yields null and the caller simply reports no timestamp.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectName) || projectName.includes('..')) {
    return null
  }
  return `${engineStoreDirectory(home)}/${projectName}.db`
}

/**
 * Where the CLI keeps its own logs.
 *
 * Separate from the extension's log and worth reaching: the extension records
 * what it asked for, the engine records what happened inside indexing - the
 * worker crashes the extension only ever sees as an exit code land here.
 */
export function engineLogDirectory(home: string): string {
  return `${home.replace(/\\/g, '/')}/.cache/codebase-memory-mcp/logs`
}

/**
 * Where Git Bash lives when it is installed.
 *
 * Checked rather than assumed: offering a Git Bash command line to someone
 * who has no Git Bash is worse than offering only PowerShell.
 */
export function gitBashCandidates(env: {
  programFiles?: string | undefined
  programFilesX86?: string | undefined
  localAppData?: string | undefined
}): string[] {
  const roots = [env.programFiles, env.programFilesX86, env.localAppData]
    .filter((root): root is string => typeof root === 'string' && root.length > 0)
    .map((root) => root.replace(/\\/g, '/'))
  return roots.flatMap((root) => [`${root}/Git/bin/bash.exe`, `${root}/Programs/Git/bin/bash.exe`])
}
