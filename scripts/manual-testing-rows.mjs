// The manual-testing row registry: read it, render the document it generates,
// and derive the residue a run reports.
//
// One module rather than one per consumer, because the registry has exactly
// three readers - the doc generator, the drift check, and `scripts/autotest.mjs`
// - and the value of a single source of truth disappears the moment two of them
// parse it differently.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const registryPath = join(repoRoot, 'docs', 'manual-testing-rows.json')
export const templatePath = join(repoRoot, 'docs', 'MANUAL-TESTING.template.md')
export const docPath = join(repoRoot, 'docs', 'MANUAL-TESTING.md')

const SECTIONS = ['A', 'B', 'C']
const STATUSES = ['automated', 'human', 'unrun']
const PRIORITIES = ['Blocking', 'Important', 'Nice to have']
const TIERS = ['integration', 'unit']

/** A row's identity: section plus number, never the number alone. 14 and 15 each appear twice. */
export function rowId(row) {
  return `${row.section}${String(row.number)}`
}

/** Read the registry and reject anything the generator or the checks could not trust. */
export function readRegistry() {
  const parsed = JSON.parse(readFileSync(registryPath, 'utf8'))
  const rows = parsed.rows
  const problems = []
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${registryPath} has no rows`)
  }

  const seen = new Set()
  for (const row of rows) {
    const id = rowId(row)
    if (!SECTIONS.includes(row.section)) problems.push(`${id}: unknown section ${row.section}`)
    if (!Number.isInteger(row.number)) problems.push(`${id}: number is not an integer`)
    if (seen.has(id)) problems.push(`${id}: duplicate row`)
    seen.add(id)
    for (const field of ['area', 'task', 'expected']) {
      if (typeof row[field] !== 'string' || row[field].trim() === '') {
        problems.push(`${id}: ${field} is missing`)
      }
    }
    if (!PRIORITIES.includes(row.priority)) problems.push(`${id}: unknown priority ${row.priority}`)
    if (!STATUSES.includes(row.status)) problems.push(`${id}: unknown status ${row.status}`)
    // A row that claims automation has to say what covers it, or the claim is
    // prose again and nothing can check it.
    if (row.status === 'automated' && typeof row.test !== 'string') {
      problems.push(`${id}: status automated without a test identifier`)
    }
    if (row.tier !== undefined && !TIERS.includes(row.tier)) {
      problems.push(`${id}: unknown tier ${row.tier}`)
    }
    if (row.tier !== undefined && row.test === undefined) {
      problems.push(`${id}: tier without a test identifier`)
    }
  }

  if (problems.length > 0) {
    throw new Error(`the row registry is invalid:\n- ${problems.join('\n- ')}`)
  }
  return rows
}

/** The tier a row's test identifier belongs to; integration unless it says otherwise. */
export function tierOf(row) {
  return row.tier ?? 'integration'
}

function statusCell(row) {
  if (row.status === 'automated') return `automated - \`${row.test}\``
  // A human row may still carry a test: that names the half automation reaches,
  // and hiding it would make the doc claim less coverage than exists.
  if (row.status === 'human' && row.test !== undefined) return `human - part covered by \`${row.test}\``
  return row.status
}

function escapeCell(value) {
  return value.replaceAll('|', '\\|')
}

function renderTable(rows) {
  return [
    '| # | Area | What to do | Expected | Priority | Status |',
    '|---|---|---|---|---|---|',
    ...rows.map((row) =>
      `| ${String(row.number)} | ${escapeCell(row.area)} | ${escapeCell(row.task)} | ` +
      `${escapeCell(row.expected)} | ${row.priority} | ${escapeCell(statusCell(row))} |`,
    ),
  ].join('\n')
}

function renderReleaseChecklist(rows) {
  const human = rows.filter((row) => row.status === 'human')
  const unrun = rows.filter((row) => row.status === 'unrun')
  const line = (row) =>
    `- [ ] **${rowId(row)}** ${row.area} (${row.priority})${row.note ? ` - ${row.note}` : ''}`

  const blocking = human.filter((row) => row.priority === 'Blocking')
  const skippable = human.filter((row) => row.priority !== 'Blocking')

  return [
    '### Must be run',
    '',
    ...(blocking.length === 0 ? ['Nothing - no `Blocking` row is human-only.'] : blocking.map(line)),
    '',
    '### May be skipped with a recorded sign-off',
    '',
    ...(skippable.length === 0
      ? ['Nothing - every remaining human row is `Blocking`.']
      : skippable.map(line)),
    '',
    '### Automatable, no test yet',
    '',
    ...(unrun.length === 0
      ? ['Nothing - every automatable row has a test.']
      : unrun.map((row) => `- ${rowId(row)} ${row.area}${row.note ? ` - ${row.note}` : ''}`)),
  ].join('\n')
}

/** Render docs/MANUAL-TESTING.md from the template and the registry. */
export function renderDoc(rows = readRegistry()) {
  let out = readFileSync(templatePath, 'utf8')
  const markers = [
    ...SECTIONS.map((section) => [
      `<!-- generated:rows:${section} -->`,
      renderTable(rows.filter((row) => row.section === section)),
    ]),
    ['<!-- generated:release-checklist -->', renderReleaseChecklist(rows)],
  ]
  for (const [marker, replacement] of markers) {
    if (!out.includes(marker)) {
      throw new Error(`${templatePath} is missing the marker ${marker}`)
    }
    out = out.replace(marker, replacement)
  }
  return out
}

/**
 * The residue a run reports, derived from the registry rather than from a
 * constant in the report code: when a row changes status, what the run says it
 * did not check changes with it.
 */
export function residue(rows = readRegistry()) {
  const by = (status) => rows.filter((row) => row.status === status)
  const ids = (list) => list.map(rowId).join(', ')
  const automated = by('automated')
  const human = by('human')
  const unrun = by('unrun')
  const partial = human.filter((row) => row.test !== undefined)

  return [
    `${String(automated.length)} automated rows covered (${ids(automated)}), ` +
      `${String(human.length)} human rows not covered (${ids(human)}), ` +
      `${String(unrun.length)} unrun (${ids(unrun)}).`,
    ...(partial.length === 0
      ? []
      : [
          `Part-covered, and still human as a whole: ${ids(partial)}. ` +
            'A passing test there answers one half of the row, never the row.',
        ]),
    'The release checklist in docs/MANUAL-TESTING.md names which of the human rows block a release.',
  ].join('\n\n')
}
