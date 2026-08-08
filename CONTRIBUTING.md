# Contributing

Pull requests are welcome. Open them against `main`.

For anything larger than a bug fix, an issue first saves work on both sides - it is not required, but it is the cheapest way to find out whether a change fits before you write it.

## What belongs here and what belongs upstream

This extension operates the `codebase-memory-mcp` CLI: it downloads the binary, verifies it, registers the MCP server, and gives the whole thing a VS Code surface. It does not implement indexing or the knowledge graph.

Indexing behaviour, graph contents, and what the MCP server returns come from [the upstream CLI project](https://github.com/DeusData/codebase-memory-mcp/issues) and are best raised there. How this extension installs, updates, configures, or invokes that CLI belongs here.

Security problems go through [SECURITY.md](SECURITY.md), not a pull request.

## Getting set up

Node 20 and a VS Code recent enough for the manifest's `^1.85.0` engine.

```
npm ci
```

`npm ci` runs install scripts deliberately - esbuild and `@vscode/vsce-sign` need them, and there is no build without them.

## What to run before opening a pull request

Four checks run on every pull request, and all four have to pass. Run them locally in the same shape:

| Check | Command |
| --- | --- |
| `lint` | `npm run lint` (a type-check, `tsc --noEmit`) |
| `test-unit` | `npm run test:unit` |
| `test-package` | `npm run test:package` |
| `test-integration` | `npm run test:integration` |

The integration tier is the awkward one: it downloads and launches a real VS Code. On macOS and Windows it runs as-is. On Linux it needs a display and it needs the sandbox off, because the usual CI and container images deny unprivileged user namespaces:

```
xvfb-run -a npm run test:integration
```

The `--no-sandbox` flag is applied by the test runner itself on Linux, so you do not pass it by hand.

`test-integration` runs on both Ubuntu and Windows in CI, because the extension carries real Windows-specific branches - shell selection, profile paths, the Git Bash uninstall command - that no other tier exercises. If you change any of those, say in the pull request which platform you actually tested on.

## Changelog

`CHANGELOG.md` is maintained by hand, and the maintainer writes the entry at merge. Do not add one in your pull request: parallel pull requests would collide on the same lines for no benefit.

Say what changed in the pull request description instead - that is what the entry gets written from.

## Commits and pull requests

Keep a pull request to one concern. Link the issue it resolves. Beyond that there is no commit message convention to follow.
