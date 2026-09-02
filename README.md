# multiagent-coordinator

Compact cross-session coordination for Cursor agents: a workspace `handoff.md` as the source of truth, pull-based MCP, and fail-open hooks. No LLM scheduler and no hook follow-up loops.

Portable **Node.js** (`node >= 18`) — Windows, macOS, Linux. No compile step.

## Installation

Install **`multiagent-coordinator`** as a Cursor plugin from the marketplace that hosts it. For local development, link this repository into `~/.cursor/plugins/local/` and reload Cursor.

This plugin ships:

| Component | Role |
| --------- | ---- |
| [skills/handoff/SKILL.md](skills/handoff/SKILL.md) | `/handoff` replace of `handoff.md` (Cursor) |
| [rules/handoff.mdc](rules/handoff.mdc) | always-applied coordination contract |
| [commands/handoff.md](commands/handoff.md) | `/handoff` for Claude Code only |
| [mcp-cursor.json](mcp-cursor.json) | stdio MCP `get_handoff` / `write_handoff` |
| [hooks/hooks-cursor.json](hooks/hooks-cursor.json) | `sessionStart`, `beforeSubmitPrompt`, `stop` |

Plugin hooks and MCP servers run from the opened project, not from the plugin
directory, so the plugin-managed configs anchor script paths with
`${CURSOR_PLUGIN_ROOT}` and rely on the host to expand it.

Installers that copy config into the user scope instead of loading the plugin
need the user-scope variants, because plugin-root variables are not expanded
there:

- [mcp.json](mcp.json) — path relative to the home directory the user-scope server is spawned from, safe to merge into `~/.cursor/mcp.json`. Avoid `${userHome}`: on Windows it expands to `/c:/Users/<user>` and the leading slash breaks module resolution.
- [hooks/hooks-user.json](hooks/hooks-user.json) — merge these events into `~/.cursor/hooks.json`, where commands run from `~/.cursor/`

Both assume the installer lays skills out as
`~/.cursor/skills/<source>/<plugin>/handoff/`. A copy of `hooks-cursor.json`
under `~/.cursor/hooks/<source>/<plugin>/` is not loaded by Cursor — merge
[hooks/hooks-user.json](hooks/hooks-user.json) into `~/.cursor/hooks.json`, or
install into `~/.cursor/plugins/` so the host expands plugin-root variables
and registers hooks from the manifest.

## Skills

- [skills/handoff/SKILL.md](skills/handoff/SKILL.md) — replace the bounded handoff snapshot
- [skills/handoff/scripts/](skills/handoff/scripts/) — store, hooks, and MCP entry points

## Rules

- [rules/handoff.mdc](rules/handoff.mdc) — keep handoff current at durable boundaries; never hook follow-up loops

## Commands

- [commands/handoff.md](commands/handoff.md) — Claude Code slash entry for `/handoff`. Cursor does **not** ship this command: the skill alone already appears in the slash palette (`disable-model-invocation: true`), and declaring both produced two identical `/handoff` entries. After upgrading from an older install, delete a leftover `~/.cursor/commands/multiagent-coordinator/` if a duplicate persists.

## MCP

- [mcp-cursor.json](mcp-cursor.json) — `get_handoff`, `write_handoff` (full replace, max 8000 chars, compare-and-swap `expected_revision`)
- [mcp-claude.json](mcp-claude.json) — same server anchored with `${CLAUDE_PLUGIN_ROOT}`
- [mcp.json](mcp.json) — user-scope variant with a home-relative path, for installers that merge into `~/.cursor/mcp.json`

The server has no workspace of its own, so it asks the client for one through
MCP `roots/list` on every tool call (a user-scope process is shared across
windows). Resolution order: `MAC_SCOPE`, then client roots. If neither is set
the tools fail instead of writing under `process.cwd()`. Results include
`workspace` so the caller can see which directory was used.

## Hooks

- [hooks/hooks-cursor.json](hooks/hooks-cursor.json) — inject `[MULTIAGENT SESSION]` and `[MULTIAGENT HANDOFF]` on session start; journal prompt hash and stop status; never `followup_message`
- [hooks/hooks-user.json](hooks/hooks-user.json) — same events for a user-scope `~/.cursor/hooks.json` merge

## Local state

Runtime data lives in the **consuming workspace**. The state directory ignores itself, so nothing has to be added to the project `.gitignore`:

```text
.cursor/multiagent-coordinator/
├─ .gitignore      # written on first use: `*`
├─ handoff.md
├─ events.jsonl
└─ sessions/
```

Hooks and the MCP server create the directory and the `.gitignore` on first use. An existing `.gitignore` is never overwritten.

Override with `MAC_STATE_DIR` or `MAC_SCOPE` when needed.

## Development

```bash
node --test skills/handoff/scripts/tests/*.test.js
```

On Windows PowerShell:

```powershell
node --test skills/handoff/scripts/tests/store.test.js skills/handoff/scripts/tests/context.test.js skills/handoff/scripts/tests/mcp-server.test.js skills/handoff/scripts/tests/hooks.test.js
```

## License

MIT
