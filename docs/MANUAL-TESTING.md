# Manual test checklist - Better Codebase Memory MCP

What automation cannot reach, and therefore what a human still has to check by hand.

419 unit tests cover the pure logic: parsing, state transitions, URL and checksum handling, path resolution, wizard steps, and the download/verify/install sequence against injected stubs. Those tests spawn no processes, touch no network, and write no files. That is deliberate - but it means everything below is still unproven on real hardware.

## Sign-off

**1.1.0 needs row 13 re-run, and nothing else.** It adds the `daemon stop` command rows to the survived-daemon notice, which is row 13's subject in a second place: the copied string has to be the resolved binary in both shell spellings, and the notice itself only appears after an update across a running 0.10.x daemon, which is row 17. Everything else in the panel is untouched, so the sign-offs below continue to speak for it.

**1.0.3 carries no re-run, and does not need one.** It is a documentation release: the packaged extension is what 1.0.2 shipped, and the only difference inside the `.vsix` is the README the marketplaces render. A listing shows the README that was packaged with it rather than the one on GitHub, which is why a doc change needs a version at all. Nothing below is exercised by it, so the sign-offs already recorded here continue to speak for the shipped code.

Every row below was run against `better-codebase-memory-mcp-0.9.13.vsix` in a scratch profile and passed, on Windows 11 on 2026-08-09 and 2026-08-10 and on macOS on 2026-08-10. Row 13 was run on both platforms; the Linux clipboard variant is still open, and Linux is not a release target for this iteration.

Rows 8, 9, B14 and B15 were re-run against `better-codebase-memory-mcp-0.9.17.vsix` on 2026-08-13, on Windows 11 and on macOS, and passed on both. The earlier sign-off does not speak for them: it predates the definition provider that replaced the file registration entirely. Three things about how this run was set up are worth keeping, because each of them is a way the run could have passed while measuring nothing:

- **It ran in the default profile, not a scratch one.** `mcp.json` lives per profile, and two separately created scratch profiles on two machines are two unrelated local profiles that Settings Sync never connects. B14 in a scratch profile would have passed without a single file crossing between the machines, which is not the question it asks.
- **What separates a pass from a coincidence is the name in the server list.** `Codebase Memory` is the provider's label from the `betterCmm.codebaseMemory` contribution; `codebase-memory-mcp` is the key the CLI writes into `mcp.json`. Both can be listed at once, because VS Code namespaces server identity by source and does not deduplicate across the two, so "a server is listed" proves nothing on its own.
- **The two `14`s and the two `15`s in this document are different rows.** Section B numbers a two-machine test and a changed-binary test; section C reuses both numbers for panel appearance and a large project. B14 and B15 are the rows covered here.

What this run does not cover is [issue #801](https://github.com/smoochy/homelab-private/issues/801), found while preparing it rather than while running it: the CLI's `install` writes its entry into every VS Code profile it finds, and the extension removes it only from the profile it is running in. On the Windows machine that left nine profile copies of `mcp.json` holding an absolute Windows path, every one of them carried between machines by Settings Sync. B14 reads the default profile on each machine and passes there, because the default profile is precisely the one the extension cleaned.

Six rows failed on the first attempt and were fixed on the branch before they passed: #3 reported the bare `fetch failed` with no indication that it was a network problem, #9 warned about an entry naming another binary without offering any way out of it, #11 reported a locked target as a half-finished install, #13 put the bare `codebase-memory-mcp install` in the clipboard instead of the resolved binary, and the same command was unusable in Git Bash, which reads its leading call operator as a background job. Each fix carries a unit test.

Two observations that are behaviour rather than defects, recorded so the next run does not chase them:

- **#15**: node and edge counts do not climb during indexing. Adding a repository is a single CLI call that returns its counts on completion, so the panel has nothing partial to show and the figures jump at the end. 17,748 files indexed in 72 seconds.
- **#16**: polling pauses when the panel is not visible, so the debug log stops too. Both stop for the same reason.

The extension log twice recorded `listing projects failed: CLI exited with 1` in the seconds after registering the MCP server, healing itself on the next refresh. Tracked separately as a warning with a misleading message, not a release blocker.

**Status legend**

- **Blocking** - must pass before the extension is published.
- **Important** - a defect here is user-visible but not dangerous.
- **Nice to have** - polish; ship without it if time is short.

---

## A. Cannot be automated at all

These need a real GitHub release, real network conditions, or a real MCP client.

| # | Area | What to do | Expected | Priority |
|---|---|---|---|---|
| 1 | First start | Install the `.vsix` in a clean profile, open the panel | Setup prompt appears, no error notification | Blocking |
| 2 | Download | Run setup, choose `managed` | Binary lands in `~/.local/bin`, checksum verified, no terminal prompt; the Setup button fills with a percentage and reads "Installing..." past 90 | Blocking |
| 3 | Offline | Disable the network, run setup | Clear error message, **no half-written binary left behind** | Blocking |
| 8 | Provided MCP server | After Setup, check the MCP server list and this installation's own `mcp.json` - the one beside its `globalStorage` | "Codebase Memory" is listed as coming from this extension and starts; the file holds **no** `codebase-memory-mcp` key, not even right after Setup ran the CLI's `install` | Blocking |
| 10 | Update | With an older managed binary, restart | Update offer appears and applies; Windows update succeeds while the server runs | Blocking |
| 11 | Windows rollback | Lock the target file, then update | Old binary restored, error explains where the backup is | Blocking |

**Why these matter most.** #2, #3 and #11 exercise the code that writes an executable to disk. The unit tests prove a checksum mismatch aborts without writing, but only a real run proves the same on a genuine interrupted download.

---

## B. Automation-adjacent - verify the real behaviour matches the tested logic

The logic is unit-tested; what is untested is whether the extension wires it to the real VS Code API correctly.

| # | Area | What to do | Expected | Priority |
|---|---|---|---|---|
| 4 | External binary | Set `binarySource` to `external`, point at your own install | No update button, no install button, panel still lists projects | Blocking |
| 5 | Workspace | Open a repository, look at the project list | Workspace is **not** listed as a project by itself | Blocking |
| 6 | Add repositories | Add several folders at once | All indexed, `workspaceFolders` unchanged, no folder added to the workspace | Blocking |
| 7 | Remove project | Remove a project | Confirmation mentions the index only, never the workspace | Blocking |
| 9 | Hand-written entry | Add a `codebase-memory-mcp` entry to `mcp.json` by hand and reload | The provided server and the hand-written one appear side by side as separate servers; the extension does not remove the entry outside its own `install` call | Important |
| 14 | Two machines, Settings Sync on | With Settings Sync enabled on a Windows and a macOS machine, run Setup on both and use the server on each | Both work at once and neither inherits the other's absolute path; `mcp.json` carries no entry of ours on either machine, so there is nothing to ping-pong | Blocking |
| 15 | Changed binary | Switch `binarySource`, or take an update, without reloading the window | The provided server carries the new binary - VS Code offers to refresh the tools rather than requiring a window reload | Blocking |
| 17 | Update across the daemon | With a CLI 0.10.x engine running (any CLI call starts its daemon), take an update from the panel | The panel does not warn about a surviving daemon, the project list still renders, and reindex works without a window reload | Blocking |
| 18 | Branch and staleness on 0.10.x | Against a 0.10.x binary, look at an indexed git checkout, then commit in it and refresh | The card shows the branch, and the project is reported as outdated after the checkout moves | Important |
| 12 | Uninstall | Uninstall the extension | No terminal opens; copy-command hint discoverable in the README | Important |
| 13 | Clipboard | Run the copy-uninstall and copy-daemon-stop commands on Windows, macOS, Linux | Correct string in the clipboard on each, and the pasted line runs in the shell it is labelled for | Important |

**#4, #5, #6 and #7 are the requirements you set personally** - the workspace must never be touched, and an installation the extension does not own must never be written to. Worth checking first.

---

## C. Visual and performance - human judgement only

| # | Area | What to do | Expected | Priority |
|---|---|---|---|---|
| 14 | Panel appearance | Switch light, dark, high contrast themes | Readable, no unstyled flash, no horizontal scrollbar | Important |
| 15 | Large project | Index a repository with >10,000 files | Panel responsive, statistics update, no editor freeze | Important |
| 16 | Idle cost | Leave VS Code open with the panel hidden for an hour | No CLI processes spawned while hidden | Nice to have |

---

## Known gaps to confirm while testing

Deferred during implementation; each is recorded in the SDD ledger.

1. **The release lookup is cached for the whole session.** A release published while VS Code is open is not noticed until the window reloads. Running **Update Binary** always checks GitHub directly, so it is never stale. Worth confirming during test #10 that the banner appears at all after a restart with an older binary in place.
2. **No progress line for the final install step.** The in-process binary move reports nothing; the panel keeps showing "Verify the download" until it finishes. Cosmetic - the operation is instant.
3. **SHA-256 only, no signature check.** The binary is verified against the release's own `checksums.txt`. That detects corruption and tampering in transit, but not a compromised release. Accepted for iteration 1.
4. **No hardening against a malicious `tar` member path.** Extraction trusts the archive's internal paths. Relevant only if the upstream release is compromised.

---

## Running the integration suite (`npm run test:integration`)

⚠️ **It will not run from a terminal inside VS Code without one change.** VS Code exports `ELECTRON_RUN_AS_NODE=1` to its integrated terminals. That variable makes the downloaded `Code.exe` run as plain Node, so it reports `v24.18.0` and rejects every VS Code flag with `bad option: --disable-extensions` and so on. Clear it first:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:integration
```

An external terminal (one not launched by VS Code) does not need this. The variable is inherited from the editor, not set by this repo.

Two related traps, both now guarded in [test/integration/runTest.ts](../test/integration/runTest.ts):

- `npm` reported **exit 0 even when zero tests ran**. The suite now writes its result to `.vscode-test/integration-result.json` and the runner fails if that file is missing or reports no passing tests, so a silent run can no longer look like a pass.
- The runner launches the Electron binary directly. `bin/code.cmd` is the CLI wrapper - it spawns VS Code detached and returns immediately, reporting success without ever loading the tests.

**None of this was an extension defect.**
