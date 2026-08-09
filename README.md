# Better Codebase Memory MCP

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/smoochy.better-codebase-memory-mcp?label=Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=smoochy.better-codebase-memory-mcp) [![Open VSX](https://img.shields.io/open-vsx/v/smoochy/better-codebase-memory-mcp?label=Open%20VSX)](https://open-vsx.org/extension/smoochy/better-codebase-memory-mcp) [![CI](https://github.com/smoochy/codebase-memory-mcp-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/smoochy/codebase-memory-mcp-vscode/actions/workflows/ci.yml) ![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-green)

[![Ko-fi](https://img.shields.io/badge/Ko--fi-smoochy-7CC6FE?logo=ko-fi&logoColor=000000)](https://ko-fi.com/smoochy) [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-smoochy84-E9C46A?logo=buymeacoffee&logoColor=000000)](https://www.buymeacoffee.com/smoochy84)

VS Code panel for operating the `codebase-memory-mcp` engine: install the CLI, register it as an MCP server, watch what it has indexed, and keep it current - without leaving the editor or memorising a command.

This extension is the operator's side of the engine. It resolves which binary is in use, verifies and installs releases, registers the MCP server through the CLI's own installer, and reports index state per repository. It is aimed at people who run [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) as day-to-day tooling and want its upkeep - installation, updates, reindexing, logs - to be visible and reversible rather than implicit.

It is an independent, clean-room TypeScript implementation. It is **not affiliated with** the `tunakite03.codebase-memory-mcp` extension, and it is not a fork of the upstream CLI.

## What it does

- **Setup in one action.** Finds an existing CLI or downloads the release for your platform, then registers it as an MCP server by running the CLI's own `install`. The Setup button fills as its own progress bar while the download runs, so the wait is visible without leaving the panel. The extension never writes an MCP entry of its own.
- **Verified updates.** A newer release is announced on the activity bar and in the panel. Taking it downloads the asset, checks it against the release's published SHA-256 checksums, and reports progress on the button that started it.
- **Project overview.** Nodes, edges, project count and total index size, plus a card per repository with its branch, index time and counts.
- **Reindexing, manual or on commit.** Reindex one project or all of them. Optional auto reindex watches the checked-out commit rather than the file system, so it acts on a pull instead of on every keystroke.
- **Settings in one place.** The extension's own settings live in VS Code; the CLI's settings are read from `config list` at runtime and edited in the panel, which VS Code's static settings UI cannot do.
- **A log worth reading.** Every user action, every install, every reindex, with a size-capped rotating file and a level you control.

## Requirements

VS Code 1.85 or newer. No other runtime dependency: the extension ships zero npm dependencies and no bundled binary.

## Binary management

The CLI is downloaded at runtime from the upstream project's GitHub releases, verified against the release's SHA-256 checksums, and installed to `~/.local/bin`. That location is not a preference. The CLI's own `install` writes an MCP entry naming an absolute path there, so a binary kept elsewhere would leave that entry pointing at a file that does not exist and the server would never start.

If you already manage your own installation, the extension prefers it and never overwrites it. Because both end up in the same directory, ownership is decided by a record written at install time rather than by the path: a binary the extension did not install is never updated, overwritten, or offered for removal. For such an installation a new release is reported and linked, but no update button appears - that upgrade is yours to run.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `betterCmm.binarySource` | `auto` \| `managed` \| `external` | `auto` | Which binary to use. `auto` prefers an existing installation, otherwise the managed one. `external` is never modified by the extension. |
| `betterCmm.externalBinaryPath` | `string` | `""` | Absolute path to your own binary. Empty searches the usual locations. Machine-scoped, so a repository cannot choose which binary runs. |
| `betterCmm.autoRefresh` | `boolean` | `true` | Poll the CLI for statistics while the panel is visible. |
| `betterCmm.refreshIntervalSeconds` | `number` | `30` | Seconds between refreshes (minimum `5`). |
| `betterCmm.autoReindex` | `boolean` | `false` | Reindex a repository once its checkout moves to another commit. |
| `betterCmm.autoReindexIntervalSeconds` | `number` | `300` | Seconds between those checks (30-3600). |
| `betterCmm.absoluteTimestamps` | `boolean` | `false` | Show index times as a date rather than an age. |
| `betterCmm.dateLocale` | `string` | `""` | Locale for absolute times, e.g. `de-DE`. Empty follows the editor. |
| `betterCmm.checkForUpdates` | `boolean` | `true` | Check GitHub for a newer CLI release. |
| `betterCmm.logLevel` | `debug` \| `info` \| `warn` \| `error` | `info` | Lowest severity written to the log. |
| `betterCmm.logMaxSizeMb` | `number` | `1` | Size a log file may reach before rotation (1-100). |
| `betterCmm.logKeptFiles` | `number` | `3` | Rotated log files kept besides the current one (1-20). |

## Projects

Adding a repository indexes it with the CLI; it does not add the folder to your VS Code workspace. Removing a project un-indexes it and leaves your workspace folders untouched. The workspace folder is never auto-added as a project.

## Uninstalling

Removing the extension does not remove the CLI. Use **Copy Uninstall Command**, or the CLI's own uninstall flow, to remove the binary as well. Removing the CLI likewise leaves the extension in place.

## Development

```bash
npm install
npm run build          # esbuild bundle into dist/
npm run lint           # tsc --noEmit
npm run test:unit      # unit suite
npm run test:package   # asserts what the .vsix ships
npm run test           # unit + integration, in a real extension host
npm run package        # vsce package --no-dependencies
```

The marketplace listing icon is committed as `media/icon.png` rather than built, since it is a published asset. Regenerate it after editing its source, `media/icon-marketplace.svg`:

```bash
uv run --with resvg-py python -c "import resvg_py; open('media/icon.png','wb').write(bytes(resvg_py.svg_to_bytes(svg_path='media/icon-marketplace.svg', width=256, height=256)))"
```

`docs/MANUAL-TESTING.md` holds the manual checklist for the paths a headless suite cannot reach. `CHANGELOG.md` records every released version.

## Licence

MIT - see `LICENSE`. An independent MIT-licensed work; the upstream CLI is MIT licensed and separately maintained.
