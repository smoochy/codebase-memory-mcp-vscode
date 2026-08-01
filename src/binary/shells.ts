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
