/** When the extension last indexed a project, and from which commit. */
export interface IndexRecord {
  /** Head commit at the time, or null when the repository reported none. */
  sha: string | null
  at: number
}

/**
 * The note to keep for a project, given what the CLI and the store file say.
 *
 * Returns the record unchanged when nothing has to move, so the caller can
 * compare by identity and only write globalState when something did.
 *
 * Two cases advance it. A project added through the picker gets its note
 * before its name is known, so the commit is filled in on the first refresh
 * that sees it. And a store file newer than the note means the index was
 * rebuilt by something other than this extension - the CLI or the MCP tool,
 * neither of which touches the note - so the current commit is adopted rather
 * than the project being reported as behind a checkout it was just built from.
 */
export function advanceIndexRecord(
  record: IndexRecord | undefined,
  head: string | null,
  storeMtimeMs: number | undefined,
): IndexRecord | undefined {
  if (record === undefined) {
    return undefined
  }
  if (record.sha === null && head !== null) {
    return { sha: head, at: record.at }
  }
  if (storeMtimeMs !== undefined && storeMtimeMs > record.at) {
    return { sha: head, at: storeMtimeMs }
  }
  return record
}
