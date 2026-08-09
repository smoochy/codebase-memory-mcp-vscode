# Changelog

## [0.9.11]

- The Setup button now fills as its own progress bar while the first install downloads, the way the update button already did. The install it runs is the same download, and pressing Setup left nothing on the panel to watch.

- The extension has a listing icon. `media/icon.png` is rasterized from `media/icon-marketplace.svg`, a coloured source kept separate from the `currentColor` activity-bar glyph in `media/icon.svg`, which renders as an invisible shape against a marketplace page.
- `categories` reads `["AI", "Other"]` rather than the default `["Other"]`, and the manifest carries `keywords` and a `galleryBanner`, so the extension is reachable by search rather than only by name.
- The repository carries its community files: issue forms for bug reports and feature requests, a chooser that routes CLI questions to the upstream project rather than here, and funding links. None of it ships inside the `.vsix`.
- `package.json` names its `repository`, `bugs` and `homepage`, so both marketplaces link an installed extension back to its source and issue tracker.
- The README's hand-maintained version badge is replaced by the Marketplace and Open VSX badges, which report the published version without a second edit at every bump, alongside a CI status badge.

## [0.9.10]

- Pushing a `v*` tag now cuts the GitHub release and publishes to both marketplaces. The publish step waits behind the `release` environment's review, and each of the two uploads checks first whether that version is already live, so re-running a tag whose first upload succeeded completes the half that failed instead of failing on the half that worked.
- The extension now activates when the window finishes starting up instead of when its panel is first opened, so the auto-refresh and auto-reindex timers run without the panel ever being visited. Previously a project could sit marked outdated for hours because nothing had woken the extension up.

## [0.9.9]

- A project indexed outside the panel - through the CLI or the MCP tool - no longer keeps the "outdated" badge. The extension records the commit for indexes it runs itself, and nothing advanced that note when someone else rebuilt the store, so the badge stayed until the panel was reopened. The stored index being newer than the note is now taken as the reindex it is.
- Lint and all three test tiers now run on every pull request and on `main`. The integration tier runs on both Ubuntu and Windows, so the Windows-only shell and profile-path branches are exercised by something other than a developer's own machine.
- The integration tests pass `--no-sandbox` on Linux, where the runner images deny the unprivileged user namespaces Electron's sandbox helper needs.
- `.github/` is excluded from the packaged extension.

## [0.9.8]

- A fresh install no longer shows a count of one on the activity bar icon before anything is pending. Clearing the badge on a rebuilt view needs a write with a value in front of it, or VS Code discards the clear as a repeat; that write was also happening on the very first view, where there was no stale count to clear and the value stuck.

## [0.9.7]

- The activity bar count now disappears once the update it announced has been taken. VS Code caches the last badge on the view object and drops a repeat, and a view rebuilt after being hidden starts with that cache empty while the old count is still on screen, so the clear was being discarded and the count survived until the window was reloaded.
- A project reported as outdated now says how large its index was at that moment, so the reindex that follows can be read against it without going back to the panel.

## [0.9.6]

- The activity bar count now also appears for a binary the extension does not manage. It will not install that update, but its owner still wants to know one exists; the tooltip says whose job it is.
- Finding a newer release is written to the log once, as debug detail, rather than on every poll or not at all. A second line is only written after the offer has gone away and a new one appears.
- This file now carries every version that was ever built, not only the recent ones, and the README describes what the extension has grown into.

## [0.9.5]

- Once the download is done the update button says "Installing..." rather than holding at a number while the archive is unpacked and moved into place, and it no longer flashes back to "Update to x" for a frame on the way out.
- A newer release is now reported for a binary the extension does not manage: the update button's place is taken by a notice in the same colour, not clickable, saying on hover that this installation is the user's to update. The release notes sit beside it as before. The extension still never writes into an installation it does not own.

## [0.9.4]

- The update button becomes the progress bar for the update it starts: the label gives way to a percentage and the button fills as the release downloads. The figure is real - bytes received against the length the response declares - and the download owns 90 of the 100 steps, the rest covering extraction and the replacement of the binary.
- The header totals gain a fourth tile: what every index costs on disk together. The tiles wrap two by two when the sidebar is too narrow for four.

## [0.9.3]

- An available engine update now shows as a count on the activity bar icon, so it is visible without opening the panel.
- The update button carries the warning colour rather than the same green as every other action, and a link to the release notes sits beside it: an update is worth reading about before taking it.
- The sidebar icon is the mark the panel header already uses.
- Installing a binary logs its URL and target path as debug detail. What the user asked for and what came of it is still logged at info.

## [0.9.2]

- Adding repositories now logs what was indexed - the repository and its node and edge counts - instead of only that it happened.
- The log names repositories the way the panel does, by their folder, rather than by the CLI's internal name with every path separator turned into a hyphen.
- Auto reindex lines are prefixed `Auto Reindex:`, and arming the timer is a debug detail rather than an info line repeating the setting change above it.
- Changing a setting no longer refreshes the panel unless the setting affects what the refresh would show. A log level or an interval caused a second CLI round trip a second after the one leaving the settings screen already did.

## [0.9.1]

- The index time now follows the mtime of the store file the CLI writes, not the moment a reindex was requested. Indexing is incremental: a reindex that finds nothing changed leaves the store untouched, and reporting "just now" for it claimed work that did not happen.
- Turning auto reindex on, or changing either interval, now takes effect at once. The timers were armed from the settings only at activation, so the feature did nothing until the window was reloaded.
- Auto reindex is logged: a debug line for every check, an info line per repository it updates, in the same format as a manual reindex. A project falling behind its checkout is logged once, when it happens.
- Opening an engine log names who asked, like the other user actions.
- Panel navigation is no longer logged.

## [0.9.0]

The "outdated" marker introduced in 0.8.0 was wrong. It compared the CLI's `git.base_sha` against `git.head_sha`, on the assumption that `base_sha` names the commit the index was built from. Measured against the real binary, that value is written when a project is first added and a reindex never advances it, so a project that fell behind stayed marked outdated permanently - including immediately after a reindex reported success. The extension now records the head commit of every index it builds itself and compares against that. A project it has never indexed makes no claim in either direction.

- New `betterCmm.autoReindex` (off by default) reindexes a repository once the checkout has moved to another commit, with `betterCmm.autoReindexIntervalSeconds` setting how often that is checked. This watches commits, not files: a `**/*` watcher per repository is what made the original extension reindex constantly. Uncommitted edits are therefore not covered.
- Concurrent indexing of one project is now refused rather than run twice.
- Absolute index times carry seconds, so two reindexes moments apart are distinguishable.
- A manual reindex writes one log line naming who asked, the repository, and the result, instead of two.

## [0.8.1]

- A malformed `betterCmm.dateLocale` value (for example "de_DE" with an underscore) used to throw inside the unhandled refresh timer, so a typo in that one cosmetic setting silently stopped the panel from updating at all. It now falls back to the host's own date formatting instead.

## [0.8.0]

- Project cards now carry an "outdated" marker when the CLI's reported `base_sha` (the commit the index was built from) differs from `head_sha` (the commit the checkout is currently on), making a stale index visible without comparing two hashes by hand.
- Absolute timestamps followed VS Code's own display language rather than the operating system's regional format, so an English-language VS Code showed American-style dates on a German machine. The new `betterCmm.dateLocale` setting overrides it; left empty, behaviour is unchanged.
- Relative times now carry minutes past the hour ("5h 24m ago" rather than "5h ago"), and a reindex report states the delta and says "unchanged" outright rather than leaving the reader to compare two counts.

## [0.7.1]

- Fixed a styling bug where a bare `.danger` rule also matched the project card's remove button, lending it the uninstall section's red top border and margin; the remove and reindex buttons no longer sit on different baselines.
- A non-numeric `refreshIntervalSeconds` bypassed the clamping used elsewhere and made the refresh timer fire roughly every millisecond, spawning two CLI processes per tick for as long as the panel stayed open. It is clamped now, and the "reload required" hint no longer fires on every settings change by comparing a snapshot against itself.

## [0.7.0]

- Project cards are more compact: the index time now sits on the stats line rather than a separate row, and the layout survives a narrow sidebar instead of breaking - names and paths ellipsize on one line, the stats line wraps, and the header no longer collides with the status chip.
- Reindexing an unchanged project used to report "finished" with nothing visibly different; indexing is incremental, so a no-op leaves the store file - and its timestamp - untouched. The counts the CLI reports are now shown and logged, so a no-op reads as one instead of looking broken.
- Extension settings changes, not only CLI settings, are now logged with their before and after values.

## [0.6.1]

- Fixed four defects found in review: a development script (scripts/install-local.mjs) was being packaged into the shipped extension; the engine-log list sorted client sessions after workers, contradicting its own intent; a single engine log file rotating away mid-listing aborted the whole list instead of skipping just that entry; and the per-project reindex button inherited the remove button's red destructive-hover styling.

## [0.6.0]

- Each project card gains its own Reindex button, alongside the existing Reindex all, and a line showing when its index was last built - read from the store file's own mtime, since the CLI reports no timestamp itself.
- Setting-change log lines now record who changed what and both the old and new value, instead of only naming the command that was clicked.
- Engine logs are grouped and empty, zero-byte files are dropped from the list, since the CLI writes one such file per client session and per indexing worker and most carry nothing.

## [0.5.1]

- Hand-edited, non-numeric `logMaxSizeMb` or `logKeptFiles` settings used to arrive as NaN, silently disabling log rotation for the life of the installation; these values are now coerced, range-checked and rounded when read.
- Opening an engine log had no error handling, so a log too large for the editor, or one rotated away between picking it and opening it, failed silently. It now reports the failure.
- Added a Clear Extension Log command, and the engine-log picker now states plainly that those files come straight from the CLI and pass through no redaction.

## [0.5.0]

- The extension log lived in a directory VS Code recreates for every window session, so the log explaining a crash was gone by the time anyone went looking for it. It now persists in global storage, bounded by rotation settings (`betterCmm.logMaxSizeMb`, `betterCmm.logKeptFiles`) that previously did nothing.
- The log level setting was declared but ignored, and every entry was written at info regardless; levels are honoured now, with debug recording every panel action.
- Added a second logs action for the engine's own logs - one file per connected client and one per indexing worker - listed newest first with size and timestamp.

## [0.4.1]

- Ownership of an installed binary is now decided by a record written at install time, not by its location. Previously, since the CLI's own installer and the extension both target `~/.local/bin`, a binary a user had installed themselves could be silently treated as the extension's own - offered for update, overwritten, and offered for deletion - contradicting the extension's own stated rule that it never touches an installation it does not own.
- Updating a binary now stages the new file beside the target and renames it into place, rather than writing straight onto the live executable, which could leave a truncated or partial binary behind if the update was interrupted.

## [0.4.0]

- The managed binary is now installed straight onto PATH (`~/.local/bin`), matching where the CLI itself registers the MCP server entry. The previous approach - extension storage plus a launcher shim on PATH - meant the registered path and the running binary never matched, so the MCP server never actually started. The shim is gone, along with the code that wrote and deleted it.

## [0.3.1]

- Hardened the PATH launcher against a planted or dangling symlink at its own name: creating it now refuses to follow a symlink at all, closing a path where an attacker-controlled file could have been created and marked executable.
- Setup no longer removes a pre-existing binary at `~/.local/bin`; whether one was already present is now checked before installing, so a copy the user placed there themselves is never silently deleted.
- Fixed incomplete shell-quoting in the generated uninstall command on both Windows and POSIX shells.

## [0.3.0]

- After registering the MCP server, the extension now replaces the CLI's own ~36 MB copy on PATH with a small launcher pointing at the managed install, so the two no longer drift apart as either is updated.
- The uninstall command is now offered for both PowerShell and Git Bash on Windows, since one spelling cannot serve both shells; the Git Bash line only appears when a Git Bash installation was actually found.
- The settings screen's `ui-lang` setting is now a dropdown built from the CLI's own description text, rather than a hardcoded list of choices.

## [0.2.1]

- The refresh timer used to replace the whole settings screen every thirty seconds, discarding anything typed into a field mid-edit; polling now pauses while a full-screen view is open.
- Config keys are now validated to look like identifiers before being accepted, closing a path where a value such as `--config-file` could enter the write allowlist and then be used as the first argument to `config set`.

## [0.2.0]

- Added a settings screen inside the panel exposing the CLI's own configuration keys, discovered at runtime via `config list`, since VS Code's settings UI can only render statically declared settings and could never show them.
- The CLI version shown in the header is now a clickable button that copies the binary's folder path, and a note now explains that registering the MCP server only takes effect after the host restarts.
- Project cards now title on the folder name rather than the CLI's hyphenated internal name, and show the parent folder instead of repeating the full path.

## [0.1.9]

- Hardened the copied uninstall command against path injection: it is now rejected outright if it contains a quote, backtick, dollar sign or line break, and `betterCmm.externalBinaryPath` and `binarySource` are now machine-scoped rather than settable per workspace, so a repository could no longer choose which binary the extension runs by shipping a hostile `.vscode/settings.json`.
- The uninstall command now runs correctly in PowerShell, the default terminal on Windows, which requires the call operator (`&`) that other shells reject in that position.

## [0.1.8]

- Setup now downloads the binary and registers it as an MCP server in a single click; previously the registration step had to be run manually afterwards, despite the panel describing Setup as doing both.
- Added an inline uninstall screen explaining what the uninstall command does and why it has to be run manually, showing the command as selectable text with copy and cancel actions, instead of silently copying it to the clipboard.
- The copied uninstall command is now bound to the extension's own resolved binary path rather than the bare CLI name, which only worked when the CLI happened to already be on PATH.

## [0.1.7]

- Hardened the new log file: a lone carriage return in untrusted process output could start a line at column zero and pass for a genuine log entry when the file is later read as evidence, so all line-break forms are escaped now. A single oversized entry is capped rather than allowed to consume the whole rotation budget, and secret redaction now also matches password, secret, credential and private_key, not only token and api_key.

## [0.1.6]

- The Setup screen's "Install binary" button is renamed "Setup" and now names both of its steps and links the release it downloads, neither of which was explained before.
- "View logs" now opens a persisted log file in an editor, honouring the rotation settings the code already contained but nothing had ever called; previously the only log lived in memory and was lost when the window closed.
- The CLI uninstall command, previously unreachable from the UI at all, is now in the view title menu.

## [0.1.5]

- Fixed a defect that could freeze the panel permanently: project node/edge/size counts from the CLI were cast without validation, and a malformed value could throw during rendering inside the refresh timer, which has no error handler, leaving the panel stuck on stale data forever. Counts are now normalised at the point the untyped CLI payload is parsed.

## [0.1.4]

- Fixed adding repositories doing nothing: the extension passed `--path` where the CLI expects `--repo-path`, an unrecognised flag the CLI silently ignored by falling back to indexing its own working directory, which then crashed.
- Added the panel actions the original specification called for but which were missing entirely: a settings gear and refresh in the view title bar, a Reindex action, a Setup action, a Projects count tile, and project cards showing size and git branch.

## [0.1.3]

- Fixed every CLI call hanging until it timed out and returning nothing: the child process's stdin was left open, and the wrapped binary waits for input on stdin before responding. This, more than the envelope-parsing fix in the previous release, was the real cause of refreshing and adding repositories appearing to do nothing.
- Hardened the response parsing so a malformed CLI payload - null, wrong types, unstringifiable values - can no longer throw inside the unhandled refresh timer and break the panel.

## [0.1.2]

- Fixed the panel always showing no projects: every CLI response is wrapped in an MCP tool-result envelope, and the code was returning that envelope itself as the data rather than unwrapping it.
- Errors from a crashed indexing run were being parsed as an empty success, so failures were invisible; they now surface through a notification, an error message offering "View logs", and the output channel.
- Clicks landing on a button's inline icon were being dropped, since the click handler only recognised HTMLElement targets and an inline SVG is an SVGElement.

## [0.1.1]

- Fixed the packaged extension shipping a stale bundle built before the panel rewrite, so installing it showed the old unstyled UI even though every test passed: there was no `vscode:prepublish` script, so packaging never rebuilt `dist/` before bundling it.
- Fixed integration tests failing before any test ran when `ELECTRON_RUN_AS_NODE` was set in the environment, which made the VS Code test host run as plain Node and reject its own command-line flags.

## [0.1.0]

Independent rewrite of the `tunakite03.codebase-memory-mcp` extension, fixing seven verified defects in the original:

1. The bundled binary no longer takes hard priority over an existing `~/.local/bin` or `PATH` installation; an existing user installation is preferred. Ownership is tracked by a record written at install time rather than inferred from the location, since the CLI's own installer targets the same directory - a binary this extension did not install is never updated, overwritten, or offered for removal.
2. The binary path is re-resolved before every spawn, not just at `activate()`, so a binary removed at runtime no longer causes an `ENOENT` retry loop.
3. The primary workspace path is no longer assumed to be `workspaceFolders[0]`; the workspace folder is never auto-registered as a project.
4. Auto-indexing no longer fights a deliberately removed project entry.
5. Adding a repository no longer forces a workspace-folder update before indexing, and no longer aborts silently on failure.
6. Repository selection allows adding more than one repository per dialog.
7. Adds a full `contributes.configuration` settings section (previously none existed).

Also drops the original's redundant `**/*` filesystem watcher; indexing relies on the CLI's own `auto_watch`.

Ships zero runtime npm dependencies. The `codebase-memory-mcp` binary is downloaded from GitHub releases at runtime and verified against the release's SHA-256 checksums; no binary is bundled with the extension.
