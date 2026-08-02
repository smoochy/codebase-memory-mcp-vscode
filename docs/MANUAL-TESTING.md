# Manual test checklist - Better Codebase Memory MCP

What automation cannot reach, and therefore what a human still has to check by hand.

231 unit tests cover the pure logic: parsing, state transitions, URL and checksum handling, path resolution, wizard steps, and the download/verify/install sequence against injected stubs. Those tests spawn no processes, touch no network, and write no files. That is deliberate - but it means everything below is still unproven on real hardware.

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
| 2 | Download | Run setup, choose `managed` | Binary lands in global storage, checksum verified, no terminal prompt | Blocking |
| 3 | Offline | Disable the network, run setup | Clear error message, **no half-written binary left behind** | Blocking |
| 8 | MCP entry | After `install`, restart VS Code, check the MCP server list | `codebase-memory-mcp` present and starts | Blocking |
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
| 9 | Path conflict | Point the MCP entry at a different binary by hand | Warning shown, nothing changed automatically | Important |
| 12 | Uninstall | Uninstall the extension | No terminal opens; copy-command hint discoverable in the README | Important |
| 13 | Clipboard | Run the copy commands on Windows, macOS, Linux | Correct string in the clipboard on each | Important |

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

## Not yet run by me

### Running the integration suite (`npm run test:integration`)

**6 passing, 0 failing** as of the last run, alongside 231 unit tests.

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
