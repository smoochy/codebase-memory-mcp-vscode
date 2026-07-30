# Changelog

## [0.1.0]

Independent rewrite of the `tunakite03.codebase-memory-mcp` extension, fixing seven
verified defects in the original:

1. The bundled binary no longer takes hard priority over an existing `~/.local/bin` or
   `PATH` installation; an existing user installation is preferred.
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
