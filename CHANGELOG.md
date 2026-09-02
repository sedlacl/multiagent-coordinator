# Changelog — multiagent-coordinator

All notable changes to this plugin are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

## [0.3.0] - 2026-09-02

### Added

- Named workspace handoffs: `/handoff <name>` and `/handson [name]`.
- Named global handoffs shared across workspaces: `/global-handoff <name>` and `/global-handson [name]`.
- MCP `list_handoffs`, `get_handoff`, `write_handoff`, `list_global_handoffs`, `get_global_handoff`, and `write_global_handoff` tools.
- Global state location `~/.multiagent-coordinator/handoffs/`, overrideable with `MAC_GLOBAL_STATE_DIR`.
- Claude Code command wrappers for the four explicit handoff operations.

### Changed

- The primary model is now explicit transferable context rather than automatic cross-session synchronization.
- Workspace snapshots live under `.cursor/multiagent-coordinator/handoffs/<name>.md`.
- The default Cursor plugin no longer registers hooks. Existing hook implementations and configs remain in the repository as optional/experimental infrastructure.
- The always-applied rule now forbids automatic handoff reads/writes and treats handoffs as user-driven boundaries.
- MCP workspace tools remain fail-closed when no root can be resolved; global handoff tools work independently of workspace roots.

### Preserved

- Compare-and-swap revisions and atomic writes prevent stale sessions from silently overwriting newer handoff state.
- Existing hook/session/event implementation is retained for future concrete coordination use cases.

## [0.2.0] - 2026-09-02

### Fixed

- MCP stdio responses are newline-delimited JSON. The server wrote LSP-style `Content-Length` frames, which no MCP client parses, so the handshake timed out after the client had spawned it. Tests missed it because both sides shared the encoder; a test now asserts the wire format directly.
- `initialize` echoes the client's `protocolVersion` instead of always answering `2024-11-05`.
- Plugin-managed hook and MCP configs anchor the script paths with the host's plugin-root variable (`${CURSOR_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_ROOT}`). Workspace-relative paths only resolved when the opened project was this repository, so an installed plugin could not spawn the MCP server and its hooks never fired.
- A user-scope MCP process no longer caches the first window's `roots/list` answer. Sequential tool calls from different workspaces resolve independently.
- Cursor no longer declares `commands/` in `.cursor-plugin/plugin.json`. The skill already provides `/handoff` in the slash palette, so shipping both produced two identical entries. Claude Code still uses `commands/handoff.md`.

### Changed

- `get_handoff` and `write_handoff` include `workspace` (and `handoff_path` on write). `HANDOFF_WRITE` events log the resolved workspace.
- Without `MAC_SCOPE` or client roots the tools return an error instead of falling back to `process.cwd()`.

### Added

- User-scope config variants for installers that merge into `~/.cursor` instead of loading the plugin: root `mcp.json` with a path relative to the home directory the user-scope server is spawned from, and `hooks/hooks-user.json` with commands relative to `~/.cursor/`.
- The MCP server resolves the workspace through MCP `roots/list` instead of relying on `process.cwd()`. Order: `MAC_SCOPE`, then client roots.
- Handoff snapshots record contributing Cursor session ids under **Sessions** (at most five). `sessionStart` injects `[MULTIAGENT SESSION]` so the writer can copy the current id without guessing.

## [0.1.0] - 2026-09-01

### Added

- Initial plugin with skill `handoff`, always-applied rule `handoff`, command `/handoff`, Cursor hooks, and stdio MCP (`get_handoff` / `write_handoff`)
