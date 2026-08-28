#!/usr/bin/env node
// The drift checks that keep the row registry, the generated document and the
// tests from disagreeing.
//
// Three separate questions, deliberately kept apart because they fail for
// different reasons:
//
//   1. Is the registry itself well-formed, and does the committed
//      docs/MANUAL-TESTING.md match what it generates? Deterministic, so a
//      mismatch is a plain failure - run `npm run docs:rows`.
//   2. Does every unit-tier test identifier still exist in test/unit? Also
//      deterministic: a renamed test leaves a row claiming coverage it lost.
//   3. Did every integration-tier identifier actually pass in this run? That
//      one can only be answered when the run wrote its result files. Without
//      them the answer is "cannot tell", never "no" - the harness keeps
//      `fail` (the extension is broken) apart from `error` (the run could not
//      answer), and a row check that collapsed the two would report a
//      unit-only invocation as a broken extension.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { docPath, readRegistry, renderDoc, repoRoot, rowId, tierOf } from './manual-testing-rows.mjs'

const SUITES = ['default', 'git', 'workspace']

function unitSources() {
  const dir = join(repoRoot, 'test', 'unit')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => readFileSync(join(entry.parentPath ?? entry.path, entry.name), 'utf8'))
}

/**
 * Run every check. Returns the harness vocabulary: pass, fail (something is
 * genuinely wrong), skipped (nothing to answer with, and nothing wrong so far),
 * error (a check could not be answered).
 */
export function checkRows() {
  const failures = []
  const notes = []

  let rows
  try {
    rows = readRegistry()
  } catch (err) {
    return { status: 'fail', detail: 'the registry is invalid', output: err.message }
  }

  if (!existsSync(docPath)) {
    failures.push(`${docPath} does not exist; run \`npm run docs:rows\``)
  } else if (readFileSync(docPath, 'utf8') !== renderDoc(rows)) {
    failures.push(
      'docs/MANUAL-TESTING.md does not match what the registry generates; ' +
        'run `npm run docs:rows` and commit the result',
    )
  }

  const covered = rows.filter((row) => typeof row.test === 'string')
  const sources = unitSources()
  for (const row of covered.filter((row) => tierOf(row) === 'unit')) {
    if (!sources.some((source) => source.includes(row.test))) {
      failures.push(`${rowId(row)}: no unit test is named "${row.test}"`)
    }
  }

  // Which suites reported at all. A suite that never wrote its file is the
  // reason an identifier can go unfound without the registry being wrong.
  const passed = new Set()
  const ran = new Set()
  const missing = []
  for (const suite of SUITES) {
    const file = join(repoRoot, '.vscode-test', `integration-result-${suite}.json`)
    if (!existsSync(file)) {
      missing.push(suite)
      continue
    }
    let result
    try {
      result = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      missing.push(`${suite} (unreadable: ${err.message})`)
      continue
    }
    for (const test of result.tests ?? []) {
      ran.add(test.title)
      if (test.state === 'passed') passed.add(test.title)
    }
  }

  const integrationRows = covered.filter((row) => tierOf(row) === 'integration')
  const unanswered = []
  for (const row of integrationRows) {
    if (passed.has(row.test)) continue
    if (ran.has(row.test)) {
      // Present and not passing - pending counts here. A row gated on a fixture
      // that was absent is reported pending, and pending coverage is no
      // coverage at all.
      failures.push(`${rowId(row)}: "${row.test}" ran but did not pass`)
      continue
    }
    unanswered.push(row)
  }

  if (missing.length === SUITES.length) {
    notes.push(
      `no integration result files, so ${String(integrationRows.length)} integration-tier ` +
        'identifiers were not checked',
    )
  } else if (unanswered.length > 0 && missing.length > 0) {
    return {
      status: 'error',
      detail: `${String(unanswered.length)} identifiers unfound while ${missing.join(', ')} reported nothing`,
      output: unanswered.map((row) => `${rowId(row)}: "${row.test}" not found`).join('\n'),
    }
  } else {
    for (const row of unanswered) {
      failures.push(`${rowId(row)}: no test named "${row.test}" ran in this suite`)
    }
  }

  if (failures.length > 0) {
    return {
      status: 'fail',
      detail: `${String(failures.length)} row check(s) failed`,
      output: failures.join('\n'),
    }
  }
  if (missing.length === SUITES.length) {
    return { status: 'skipped', detail: notes.join('; '), output: '' }
  }
  return { status: 'pass', detail: `${String(rows.length)} rows, ${String(covered.length)} with a test`, output: '' }
}

// Runnable on its own: `npm run check:rows`. A `fail` exits 1 (something is
// wrong), an `error` exits 2 (the check could not answer), pass and skipped
// exit 0 - the same vocabulary scripts/autotest.mjs uses.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRows()
  console.log(`${result.status.toUpperCase()} rows${result.detail ? ` - ${result.detail}` : ''}`)
  if (result.output) console.log(result.output)
  process.exit(result.status === 'fail' ? 1 : result.status === 'error' ? 2 : 0)
}
