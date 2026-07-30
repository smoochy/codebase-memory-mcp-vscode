# Better Codebase Memory MCP

An independent VS Code extension for managing the
[DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) engine (MIT
licensed): status, projects, settings, and self-managed binary updates.

This extension is **not affiliated with** the original `tunakite03.codebase-memory-mcp`
extension. It is a from-scratch, clean-room TypeScript implementation aimed at the same
underlying engine.

## Behavioral differences from the original extension

<!-- ponytail: full change table lands with the feature work in later tasks; this
     scaffold only establishes the section so later tasks append to it. -->

- Zero runtime npm dependencies (the original bundles third-party packages at runtime).
- Self-managed binary installation restricted to an explicit allow-list of download hosts.
- (Further differences to be documented as later tasks land.)

## Status

Early scaffold. Not yet functional.
