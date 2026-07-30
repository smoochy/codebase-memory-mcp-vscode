# Better Codebase Memory MCP

An independent VS Code extension for managing the
[DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) engine (MIT
licensed): status, projects, settings, and self-managed binary updates.

This extension is **not affiliated with** the original `tunakite03.codebase-memory-mcp`
extension. It is a from-scratch, clean-room TypeScript implementation aimed at the same
underlying engine.

## What it does

The extension is a panel-based frontend for the `codebase-memory-mcp` CLI. It does not embed
the CLI's own MCP server registration logic — running `codebase-memory-mcp install` (via the
**Register MCP Server** command) is what registers the MCP server with VS Code; the
extension itself never writes an MCP provider of its own. Through the panel and commands you
can:

- Run a first-time setup wizard that finds or installs the CLI binary and registers it.
- View indexing status and per-project statistics.
- Add or remove indexed project repositories.
- Copy the install/uninstall commands for manual use.
- Check for and install binary updates.
- View extension logs.

## Binary management

The `codebase-memory-mcp` binary is **not bundled** with this extension. On first use the
extension downloads the appropriate binary for your platform and architecture from the
[project's GitHub releases](https://github.com/DeusData/codebase-memory-mcp/releases),
verifies it against the release's published SHA-256 checksums, and stores it in the
extension's own storage directory. If you already manage your own installation (`~/.local/bin`
or `PATH`), the extension prefers that installation and never overwrites it (see
`betterCmm.binarySource` below).

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `betterCmm.binarySource` | `string` (`auto` \| `managed` \| `external`) | `auto` | Which `codebase-memory-mcp` binary to use. `auto` uses an existing installation when found, otherwise the managed binary. `managed` always uses the binary this extension downloads and updates. `external` always uses an installation you manage yourself; the extension never modifies it. |
| `betterCmm.externalBinaryPath` | `string` | `""` | Absolute path to your own binary. Leave empty to search the usual locations. |
| `betterCmm.autoRefresh` | `boolean` | `true` | Poll the CLI for project statistics while the panel is visible. |
| `betterCmm.refreshIntervalSeconds` | `number` | `30` | Seconds between statistics refreshes (minimum `5`). |
| `betterCmm.checkForUpdates` | `boolean` | `true` | Check GitHub for a newer release of the managed binary on startup. |
| `betterCmm.logLevel` | `string` (`debug` \| `info` \| `warn` \| `error`) | `info` | Verbosity of the extension log. |

## Project management

Adding a repository through the panel indexes it as a project with the CLI; it does not add
the folder to your VS Code workspace. Removing a project un-indexes it with the CLI and never
touches your workspace folders. The workspace folder itself is never auto-added as a project.

## Uninstalling

Removing this extension does **not** remove the `codebase-memory-mcp` binary or uninstall it
from your system. Use the **Copy Uninstall Command** command (or run the CLI's own uninstall
flow yourself) if you want to remove the binary as well.

## Testing this extension manually

See `docs/MANUAL-TESTING.md` in this repository for the manual test checklist.

## License

MIT — see the `LICENSE` file in this repository. This extension is an independent
MIT-licensed work; it is not a fork of the upstream CLI.
