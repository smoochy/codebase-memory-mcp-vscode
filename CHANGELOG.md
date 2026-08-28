# Changelog

## [Unreleased]

- Documentation and tooling only, nothing about the installed extension changes. `docs/manual-testing-rows.json` is now the single source of truth for the manual test checklist: one entry per row, keyed by section plus number, carrying its status (`automated`, `human`, `unrun`) and, where a test covers it, that test's full title. `docs/MANUAL-TESTING.md` is generated from it with `npm run docs:rows` and gains a Status column plus a generated release checklist naming which human rows block a release. `npm run check:rows` fails when the committed document and the registry disagree, when a row claims a unit test that no longer exists, and - inside `npm run autotest`, where the result files exist - when a row's integration test did not pass, which includes a test reported pending because its fixture was absent. Every run now ends by printing which rows it did not cover, derived from the registry rather than from a sentence in the harness.

- Development tooling only, nothing about the installed extension changes. `npm run autotest` runs one unattended verification pass - build, VSIX package, lint, unit, package and both integration suites - and writes a JSON record plus a Markdown summary under `.autotest/<run-id>/`, exiting 0 for a clean run, 1 when the extension is broken and 2 when the run could not answer the question. The integration suites now report every test by title and outcome rather than a bare pass count, both Electron passes always run so a failure in the first no longer leaves the second with no verdict at all, and the harness threads a fresh profile through `--user-data-dir`/`--extensions-dir` so one round cannot inherit extension-host state from the last. A new manually triggered `autotest` workflow runs the same pass on Linux, Windows and macOS; the existing required checks are untouched.

- A failing unit now prints its captured output into the run log, not only into the JSON record, and the `autotest` workflow uploads its reports again. The reports live under a dot directory, which `upload-artifact` treats as hidden and skips, so every run - including the ones where every stage passed - uploaded nothing and then failed on `if-no-files-found`. Between the two, a failure on a CI runner left no account of itself anywhere: no artifact, and a log naming the failing stage without a line of its output.

- The unattended pass runs its integration suites on macOS. Electron opens a unix domain socket inside the profile it is given, a unix socket path may not exceed 103 bytes on macOS, and the runner's per-user temp directory spends 49 of those before the profile name is added - so the host failed to listen with `EINVAL` and exited before a single test ran. The profile directory is now named by a short hash of the run id, and on macOS it sits under `/tmp`.

- Three rows of the manual checklist run unattended now, and nothing about the installed extension changes with them. A third Electron pass launches with this repo's own checkout open as the workspace and asserts that the open repository never appears as an indexed project and never changes the workspace folders, which is a row the other two passes run on an empty window and cannot observe at all. The clipboard rows cover all four copy commands - uninstall and daemon stop, in the default shell's spelling and Git Bash's - asserting the call operator PowerShell needs, the forward slashes and absent call operator Git Bash needs, and that none of them opens a terminal.

- The unattended pass tests against a real, pinned CLI binary, and still nothing about the installed extension changes. `test/fixtures/cli-pin.json` pins two upstream releases with a SHA256 per platform asset; the run downloads them once into a cache outside the checkout, verifies each against the pin rather than against upstream's republishable `checksums.txt`, and copies the newer one into a per-round scratch home at the first location the extension's own detection searches. Both `HOME` and `USERPROFILE` are handed to the Electron child, because a home lookup reads a different one of them per operating system and passing only one would leave the child on the real profile while every test still passed. An unreachable release leaves those rows as named residue and the run continues; a digest that no longer matches is reported as a failure instead, since that is a corrupted cache or a substituted release rather than an absence. Before the suites launch, the pinned binary is invoked once under the scratch home and has to exit 0 - a machine that rejects it is a hard stop with a remediation note, never a red test a fix round would chase.

- The two checklist rows behind a modal dialog run unattended, and nothing about the installed extension changes with them. The suite and the extension share one `vscode` module object, so the test assigns `showOpenDialog` and `showWarningMessage` and answers the dialog itself: the folder picker's options are asserted, a dismissed picker is proved to index nothing, and the remove confirmation is driven down both branches - dismissal leaves the project listed and writes no removal line, acceptance writes exactly one and takes the project out of the panel. Whether the confirmed branch reached the CLI is read from the extension's own log file, so no test seam is added. The halves that mutate the CLI's store run only when the pinned-binary fixture provisioned a scratch home; without it they are reported pending rather than passed, because on a developer machine those assertions would index a throwaway folder into that developer's real store. The generic command loop in `panel-render.test.ts` still excludes both commands, since it installs no stub and the modal would block it.

## [1.1.3]

- The panel shows node, edge and size counts again, along with each project's branch. CLI 0.10.8 turned `list_projects`' details into an opt-in: `include_details` now defaults to false, so every project came back carrying nothing but its name and root path, and the panel rendered "-" for every count and for the totals across the top. The extension now asks for them with `--include-details=true`. Nothing about the engine or the index was wrong here, which is why a reindex changed the log without ever changing the numbers.

## [1.1.2]

- Indexed projects no longer turn up in the Source Control view, and VS Code no longer asks to open repositories nobody opened. Stale detection reads the head commit of every project the engine holds, and it read that through the built-in git extension's `openRepository`, which does not read a repository so much as take it on: every indexed project was registered with the git extension, once per refresh, until the prompt was accepted. Measured against a store of 16 projects, the Source Control view listed all 16 rather than the one that was open. The head now comes from `git rev-parse` for every project but the workspace's own, which the git extension already has open and answers for without side effects.

## [1.1.1]

- The project list now appears as soon as the CLI has answered, rather than after the two calls that follow it. A refresh listed the projects, then read the binary's version in a second process launch, then looked up the latest release over the network, and only then handed anything to the panel - so after a window start the panel sat on its loading skeleton for the sum of all three, which the extension log measured at 42 to 47 seconds. Painting the list first cuts the version launch and the release round trip out of that wait; the remaining time is the CLI's own cold start, which this does not touch. The first paint carries the version and update offer the last refresh read, so neither blinks out while the fresh ones are fetched.
- The notice about a daemon that survived an update now says what is holding it, when the engine blames a connected client. `daemon stop` refuses while one is committed and reports it as a bare pid, which is not something the owner of the session acts on: the process behind every such pid is another `codebase-memory-mcp` that an agent started as its MCP server, so what has to be closed is that session. Until now the panel offered a command that could not succeed and never said why.

## [1.1.0]

- The notice about a daemon that survived an update now offers the `daemon stop` line as a copyable command row instead of quoting it inside the prose: PowerShell and, where it is installed, Git Bash, each with its own Copy button. The line is bound to the resolved binary, as the uninstall line already is, so a managed install that is not on `PATH` still yields something that runs.

## [1.0.3]

- Documentation only; the extension itself is byte-for-byte what 1.0.2 shipped. A marketplace listing renders the README that was inside the `.vsix` at publish time rather than the one on GitHub, so a README that only lands on `main` never reaches either listing. This version exists to carry one there.
- The listing now shows the panel, the engine settings screen and the extension settings. Both marketplaces refuse to resolve a relative image path, so the screenshots are referenced by absolute URL and left out of the package rather than shipped inside it.
- The README follows [standard-readme](https://github.com/RichardLitt/standard-readme) and gained a table of the contributed commands. Two badges were wrong rather than out of date: the CI badge named `ci.yml` while the workflow file is `ci.yaml`, and the version badge read `retired badge` because shields.io has withdrawn every Visual Studio Marketplace endpoint. The version is now carried by the Open VSX badge, which still resolves, and the Marketplace badge is a plain link.

## [1.0.2]

- First published release, on the VS Code Marketplace and on Open VSX. Nothing about the extension changes here: this is the version that ships rather than a version that adds anything, and everything it does arrived over the 0.9.x line below.
- The `allowScripts` entry for esbuild named a version the lockfile no longer resolved, so npm blocked the install script it exists to allow. It now names the resolved version.

The version is 1.0.2 because the two before it were spent on the release pipeline rather than on the extension, and neither reached a marketplace. GitHub makes a release immutable the moment it exists, so `v1.0.0` produced a release the workflow could not attach its `.vsix` to; deleting that release reserves its tag for good, and the reservation outlives even turning the setting off. `v1.0.1` then failed in the publish step, where the guard that skips an already-published version keyed on the exit code of a query that exits 0 while printing `undefined`.

## [0.9.21]

- Internal only: the compiler moves to TypeScript 7. The native compiler no longer includes everything under `node_modules/@types` on its own, so the type packages this project relies on are now named in both tsconfigs rather than found by a sweep. No behaviour changes.

## [0.9.20]

- A failed CLI call no longer blames the allocator. CLI 0.10.3 opens every run with a routine `level=warn` line about memory preloading, and a warning used to outrank everything else when a call failed without saying why - so an unrelated note was quoted as the cause, and the message the command itself wrote was hidden behind it. The command's own output now comes first, with the remaining log kept beneath it rather than dropped.

## [0.9.19]

- A rejected setting now reads as the reason it was rejected. CLI 0.10.1 started reporting an unknown config key on stderr, where it arrives behind a routine log line the CLI writes on every run, so the settings screen quoted that log line first and the actual message second.
- Internal only: the unused `index_status` client and the `ui` binary variant, both of which the CLI dropped in 0.10.0, are gone, and a pre-release tag no longer compares equal to the release it precedes.

## [0.9.18]

- The MCP entry the CLI writes is now taken back out of every profile of this installation, not only the one VS Code is running in. `install` writes an absolute binary path into the `mcp.json` of each profile it finds, and Settings Sync carries those files to other machines, where the path names nothing - so nine of ten profiles used to keep syncing a registration that could not start.
- That cleanup also runs when the extension starts, not only right after Setup. A machine that has already received such an entry heals itself on the next window rather than waiting for a Setup run that may never happen again.
- A profile whose `mcp.json` cannot be parsed is still left alone, but now says so in the log when it holds an entry of ours, instead of being indistinguishable from a profile with nothing to clean.

## [0.9.17]

- Taking an update now retires the engine the replaced binary left running. CLI 0.10.0 starts a per-user daemon on its first call and keeps it alive across sessions, and that daemon refuses clients of any other build, so from the moment the new binary was in place every call failed and reloading the window changed nothing - the daemon is a separate process that survives it.
- When that stop does not work, the panel says so and names `codebase-memory-mcp daemon stop`, rather than reporting a finished update over an engine that answers nothing. The notice clears itself as soon as a call gets through.
- The branch tag is back on the project cards against CLI 0.10.x, which moved the branch out of the `git` object into a flat field. Both shapes are read, so a binary of either generation reports its branch.
- A project whose checkout has moved since it was indexed is reported as outdated again. CLI 0.10.x reports no commit at all, so the commit now comes from VS Code's own git extension instead of from the CLI.

## [0.9.16]

- The activity-bar update badge now appears in a window that was already running when a release landed. The release lookup used to be resolved once and held for the whole session, so a window open for days kept reporting the answer it got at activation; it is now looked up again once the answer is more than six hours old.
- The refresh timer no longer does nothing at all while the panel is hidden. It runs the update check on those ticks, which costs one cached network lookup and launches no process, so the panel's CLI polling and its log lines still stop when nobody is looking at it.

## [0.9.15]

- Every request the extension makes now survives a transient failure. github.com refuses individual HTTP/2 streams under load, which arrives as a bare `fetch failed` and clears on the next attempt, and a single one of those used to end the whole Setup run.
- Retried are thrown transport failures, `429`, `5xx`, and the `403` that carries a `Retry-After`, which is how a secondary rate limit arrives on unauthenticated traffic. A `404`, a plain `403` and every redirect go back untouched: `3xx` is the normal answer here, not a failure.
- Three attempts per request, waiting 250 ms and then 1 s. A `Retry-After` may shorten that wait but never lengthen it past 1 s, so Setup does not stand still for a full rate-limit window.
- A download whose stream dies after the headers is started over once rather than failing, walking the redirect chain again because the signed asset URL it resolves to is short-lived. A checksum mismatch is never retried: re-fetching a body that failed its digest would only ask a corrupt cache, or an attacker, a second time.
- The failure message still names the host that could not be reached, now once the attempts are spent rather than on the first refusal.

## [0.9.14]

- VS Code now gets the MCP server from a definition provider rather than from `mcp.json`. The server is offered in memory for whichever binary is active and disappears with the window, so nothing about it is written to disk and nothing about it can reach Settings Sync.
- That removes the ping-pong between two synced machines outright. `mcp.json` is synced and holds one absolute command path, so a Windows machine and a Mac kept rewriting the entry for each other and each broke the other's server; a provided server has no path to sync.
- The CLI's own `install` detects VS Code as an agent and writes an entry anyway, so the extension removes that one key again after every `install` it runs, leaving every other server in the file untouched. It is a stopgap, removable once the CLI can be told to skip an agent.
- `engines.vscode` rises to `^1.101.0`, the release that finalised the provider API. Keeping the file write alive for older hosts would mean two registration paths and the whole foreign-entry branch surviving forever, and the extension has no published users to preserve.
- Gone with the file entry: the `betterCmm.autoReregisterMcpEntry` setting, the path-conflict and foreign-platform warnings, the "Register MCP server" button and the register-command clipboard buttons. There is no longer a state in which a resolved binary is not registered.
- Changing the active binary no longer asks for a window reload. The provided definition carries the CLI's version, so a switch or an update makes VS Code offer to refresh the tools instead.

## [0.9.13]

- The panel now reads the MCP registration of the VS Code instance it is running in. It located `mcp.json` from the home directory before, which named the default installation's file whatever `--user-data-dir` the instance was started with, so a second installation was told about a registration that was not its own.
- An installation with no `mcp.json` at all is now reported as unregistered rather than as registered. A file that is not there is an answer; only a file that exists and cannot be read leaves the state unknown.
- The managed install on Windows now runs `System32\tar.exe` by name instead of whatever `tar` PATH resolves to. Git for Windows puts GNU tar ahead of it, and GNU tar reads `D:\...` as a remote host, so the download failed with "Cannot connect to D: resolve failed" on any machine whose storage sits off the system drive.
- Registering now writes the MCP entry into the `mcp.json` of the VS Code instance the extension runs in. The CLI's own `install` finds VS Code by walking the default configuration directory, so a second installation started with `--user-data-dir` was reported as registered while its own config file stayed empty, and pressing "Register MCP server" again changed nothing visible. The CLI install still runs, since it also wires up the other agents it supports.
- Changing `betterCmm.autoReregisterMcpEntry` is logged like every other setting. The log diffs a hand-maintained list of keys that the setting was never added to, so it was the one setting that changed in silence; a test now fails if the list and the manifest disagree.
- A finished engine update says in the panel that the running server is still the old binary. It said so only in a notification, which VS Code collapses to a single line by default, so the one instruction that stops the update from looking like it did nothing was the part the user had to unfold.
- The activity bar reports an available engine update before the panel has ever been opened. The badge lived on the webview view, and VS Code creates that object only when the user clicks the icon, so the one moment the badge had something to say was the one moment it could not be written. It now belongs to an otherwise empty view that exists from activation and stays hidden until there is an update, which also retires the workaround for VS Code dropping the badge's clear.
- Removing a project is logged, with the folder name the panel shows and the nodes and edges the removal dropped, and a removal the CLI refuses is reported instead of discarded. Every other action on the panel left a line; this one ran silently, its result was never read, and the counts are gone from the next refresh onwards.
- Automatic re-registration says in the log why it did nothing. Each of its conditions - the setting being off, an external binary, an entry already re-registered once - left the warning on screen with no way to tell the case apart from a broken feature.
- "Copy register command" copies the command bound to the resolved binary, quoted, the way the uninstall command already was, and offers the Git Bash spelling beside the PowerShell one where Git Bash is installed. The Windows line starts with the call operator, which Git Bash reads as a background job, so the copied command registered nothing there. It copied the bare `codebase-memory-mcp install`, which needs the CLI on `PATH` - and the button only appears for an install the extension does not own, which is the one it can least assume is on it.
- An MCP entry naming a different binary on this machine offers to point it at the active one. The warning said what was wrong and left no way to act on it, so the only fix was editing `mcp.json` by hand. Nothing is rewritten without the click, since an entry pointing elsewhere can be deliberate.
- A download that cannot reach GitHub names the host it could not reach. `fetch` answers an unreachable network with "fetch failed" and nothing else, so a machine that was merely offline reported the same three words as a broken install.
- An engine update that cannot move the running binary aside now says the installation is unchanged, and no longer leaves the downloaded copy next to it. The rename that moves the old binary out of the way sat outside the rollback, so a target another process held open produced a message pointing at a backup that was never created, next to a stray `.new` file.
- The setup screen carries the "View extension log" and "View engine logs" buttons too. A failing install names a log file, and setup was the one screen that offered no way to open it.

## [0.9.12]

- An MCP entry naming another operating system's path is now reported as its own case rather than as a generic path conflict. Settings Sync copies `mcp.json` between machines and it holds one absolute path, so a second machine on a different platform inherits an entry it can never start; the panel now says which machine wrote it, offers to register here, and points at switching "MCP Servers" off under Settings Sync, which is the permanent fix.
- New machine-scoped setting `betterCmm.autoReregisterMcpEntry`, off by default, re-registers that entry without asking. It does not stop the two machines rewriting the entry for each other, it makes the exchange silent and self-healing; each binary-and-entry pair is only re-registered once, so a synced path returning after a restart is left alone.

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
