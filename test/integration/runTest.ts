import { runTests } from '@vscode/test-electron'
import { resolve } from 'node:path'

async function main(): Promise<void> {
  // The extension manifest lives at the repo root; compiled test entry
  // point lives under out/ once tsc has run (see npm run compile:test).
  const extensionDevelopmentPath = resolve(__dirname, '../../..')
  const extensionTestsPath = resolve(__dirname, './suite/index')

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
    })
  } catch (err) {
    console.error('Integration tests failed to run', err)
    process.exit(1)
  }
}

void main()
