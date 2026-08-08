# Security Policy

## Reporting a vulnerability

Report vulnerabilities through GitHub's private vulnerability reporting: [open a draft advisory](https://github.com/smoochy/codebase-memory-mcp-vscode/security/advisories/new). Reports stay private until a fix ships, and the advisory workflow can request a CVE identifier when one is warranted.

Please do not open a public issue for a security problem.

You should get an initial response within seven days. If a report turns out to belong upstream, it is redirected rather than closed silently.

## Supported versions

Only the latest version published to the Visual Studio Marketplace and Open VSX receives fixes. VS Code updates extensions automatically, so a fix reaches users as a new release rather than as a patch to an older line.

| Version | Supported |
| --- | --- |
| Latest published release | Yes |
| Anything earlier | No |

## Scope

This extension does not implement indexing or the knowledge graph. It downloads the `codebase-memory-mcp` CLI, verifies it against the SHA-256 checksums published with the upstream release, and registers an MCP server by invoking that CLI's own installer. The boundary follows from that.

In scope for this repository:

- How the extension resolves, downloads, and verifies the CLI binary, including checksum handling and the update path.
- How the extension invokes the CLI and constructs the commands it runs, including any argument or path handling that could allow injection.
- How the extension reads and applies its own settings, and what a workspace can influence by being opened.
- Anything the extension writes: MCP configuration, installed binaries, and files under the user's profile.

Out of scope here, and belonging to [the upstream CLI project](https://github.com/DeusData/codebase-memory-mcp/issues):

- Indexing behaviour, graph contents, and what the MCP server returns.
- Vulnerabilities inside the CLI binary itself.
- The CLI's own installer, once the extension has verified and handed off to it.

A report about the upstream CLI is best filed upstream directly. If a flaw only becomes exploitable because of how this extension invokes the CLI, it belongs here.

## Settings that are deliberately machine-scoped

`betterCmm.externalBinaryPath` decides which binary the extension executes. It is declared machine-scoped in the manifest, so a workspace cannot set it and merely opening an untrusted repository cannot repoint execution. Treat any change that would relax that scope as a security change.
