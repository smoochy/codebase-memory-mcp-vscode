/**
 * Package the extension and install it into the real VS Code.
 *
 * `--install-extension` on a .vsix replaces whatever version is present, so
 * there is no uninstall step: uninstalling first would leave the editor with
 * no extension at all if the install then failed.
 *
 * VS Code keeps the previous version's files until it restarts, so the window
 * has to be reloaded afterwards - the command prints that rather than assuming
 * the user knows.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const vsix = join(root, `${manifest.name}-${manifest.version}.vsix`)

/** Where the VS Code CLI lives. PATH first, then the usual install locations. */
function codeCli() {
  const candidates = [
    'C:/Program Files/Microsoft VS Code/bin/code.cmd',
    'C:/Program Files/Microsoft VS Code/bin/code',
    `${process.env.LOCALAPPDATA ?? ''}/Programs/Microsoft VS Code/bin/code.cmd`,
    '/usr/local/bin/code',
    '/usr/bin/code',
  ]
  return candidates.find((candidate) => candidate !== '/' && existsSync(candidate)) ?? 'code'
}

// Stale .vsix files from earlier versions only invite installing the wrong one.
for (const name of readdirSync(root)) {
  if (name.endsWith('.vsix') && join(root, name) !== vsix) {
    rmSync(join(root, name), { force: true })
  }
}

execFileSync('npx', ['@vscode/vsce', 'package', '--allow-missing-repository'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})

const cli = codeCli()
console.log(`installing ${vsix}`)

// ELECTRON_RUN_AS_NODE makes every Electron binary run as plain Node, so the
// VS Code launcher parses its own flags as Node options and fails. Some
// toolchains export it globally; clear it for the child rather than expecting
// the caller to.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Quoted explicitly: a .cmd cannot be spawned without a shell on current Node
// (it refuses with EINVAL), and with a shell the paths are concatenated rather
// than escaped - both of these contain spaces.
execFileSync(`"${cli}"`, ['--install-extension', `"${vsix}"`, '--force'], {
  stdio: 'inherit',
  shell: true,
  env,
})
console.log(`\n${manifest.name} ${manifest.version} installed.`)
console.log('Reload the VS Code window to pick it up: Developer: Reload Window.')
