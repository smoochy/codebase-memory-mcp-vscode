# Changelog

## [0.9.5]

- Once the download is done the update button says "Installing..." rather than
  holding at a number while the archive is unpacked and moved into place, and
  it no longer flashes back to "Update to x" for a frame on the way out.
- A newer release is now reported for a binary the extension does not manage:
  the update button's place is taken by a notice in the same colour, not
  clickable, saying on hover that this installation is the user's to update.
  The release notes sit beside it as before. The extension still never writes
  into an installation it does not own.

## [0.9.4]

- The update button becomes the progress bar for the update it starts: the
  label gives way to a percentage and the button fills as the release
  downloads. The figure is real - bytes received against the length the
  response declares - and the download owns 90 of the 100 steps, the rest
  covering extraction and the replacement of the binary.
- The header totals gain a fourth tile: what every index costs on disk
  together. The tiles wrap two by two when the sidebar is too narrow for four.

## [0.9.3]

- An available engine update now shows as a count on the activity bar icon, so
  it is visible without opening the panel.
- The update button carries the warning colour rather than the same green as
  every other action, and a link to the release notes sits beside it: an update
  is worth reading about before taking it.
- The sidebar icon is the mark the panel header already uses.
- Installing a binary logs its URL and target path as debug detail. What the
  user asked for and what came of it is still logged at info.

## [0.9.2]

- Adding repositories now logs what was indexed - the repository and its node
  and edge counts - instead of only that it happened.
- The log names repositories the way the panel does, by their folder, rather
  than by the CLI's internal name with every path separator turned into a
  hyphen.
- Auto reindex lines are prefixed `Auto Reindex:`, and arming the timer is a
  debug detail rather than an info line repeating the setting change above it.
- Changing a setting no longer refreshes the panel unless the setting affects
  what the refresh would show. A log level or an interval caused a second CLI
  round trip a second after the one leaving the settings screen already did.

## [0.9.1]

- The index time now follows the mtime of the store file the CLI writes, not
  the moment a reindex was requested. Indexing is incremental: a reindex that
  finds nothing changed leaves the store untouched, and reporting "just now"
  for it claimed work that did not happen.
- Turning auto reindex on, or changing either interval, now takes effect at
  once. The timers were armed from the settings only at activation, so the
  feature did nothing until the window was reloaded.
- Auto reindex is logged: a debug line for every check, an info line per
  repository it updates, in the same format as a manual reindex. A project
  falling behind its checkout is logged once, when it happens.
- Opening an engine log names who asked, like the other user actions.
- Panel navigation is no longer logged.

## [0.9.0]

The "outdated" marker introduced in 0.8.0 was wrong. It compared the CLI's
`git.base_sha` against `git.head_sha`, on the assumption that `base_sha` names
the commit the index was built from. Measured against the real binary, that
value is written when a project is first added and a reindex never advances it,
so a project that fell behind stayed marked outdated permanently - including
immediately after a reindex reported success. The extension now records the
head commit of every index it builds itself and compares against that. A
project it has never indexed makes no claim in either direction.

- New `betterCmm.autoReindex` (off by default) reindexes a repository once the
  checkout has moved to another commit, with `betterCmm.autoReindexIntervalSeconds`
  setting how often that is checked. This watches commits, not files: a `**/*`
  watcher per repository is what made the original extension reindex constantly.
  Uncommitted edits are therefore not covered.
- Concurrent indexing of one project is now refused rather than run twice.
- Absolute index times carry seconds, so two reindexes moments apart are
  distinguishable.
- A manual reindex writes one log line naming who asked, the repository, and the
  result, instead of two.

## [0.1.0]

Independent rewrite of the `tunakite03.codebase-memory-mcp` extension, fixing seven
verified defects in the original:

1. The bundled binary no longer takes hard priority over an existing `~/.local/bin` or
   `PATH` installation; an existing user installation is preferred. Ownership is tracked
   by a record written at install time rather than inferred from the location, since the
   CLI's own installer targets the same directory - a binary this extension did not
   install is never updated, overwritten, or offered for removal.
2. The binary path is re-resolved before every spawn, not just at `activate()`, so a
   binary removed at runtime no longer causes an `ENOENT` retry loop.
3. The primary workspace path is no longer assumed to be `workspaceFolders[0]`; the
   workspace folder is never auto-registered as a project.
4. Auto-indexing no longer fights a deliberately removed project entry.
5. Adding a repository no longer forces a workspace-folder update before indexing, and no
   longer aborts silently on failure.
6. Repository selection allows adding more than one repository per dialog.
7. Adds a full `contributes.configuration` settings section (previously none existed).

Also drops the original's redundant `**/*` filesystem watcher; indexing relies on the
CLI's own `auto_watch`.

Ships zero runtime npm dependencies. The `codebase-memory-mcp` binary is downloaded from
GitHub releases at runtime and verified against the release's SHA-256 checksums; no binary
is bundled with the extension.
