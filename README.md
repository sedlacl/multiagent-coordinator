# multiagent-coordinator

Compact cross-session coordination for Cursor agents: a workspace `handoff.md` as the source of truth, pull-based MCP, and fail-open hooks. No LLM scheduler and no hook follow-up loops.

Portable **Node.js** (`node >= 18`) — Windows, macOS, Linux. No compile step.

## Installation

Install **`multiagent-coordinator`** as a Cursor plugin from the marketplace that hosts it. For local development, link this repository into `~/.cursor/plugins/local/` and reload Cursor.

This plugin ships:

| Component | Role |
| --------- | ---- |
| [skills/handoff/SKILL.md](skills/handoff/SKILL.md) | `/handoff` replace of `handoff.md` |
| [rules/handoff.mdc](rules/handoff.mdc) | always-applied coordination contract |
| [commands/handoff.md](commands/handoff.md) | slash command `/handoff` |
| [mcp-cursor.json](mcp-cursor.json) | stdio MCP `get_handoff` / `write_handoff` |
| [hooks/hooks-cursor.json](hooks/hooks-cursor.json) | `sessionStart`, `beforeSubmitPrompt`, `stop` |

Plugin hooks and MCP servers run from the opened project, not from the plugin
directory, so both configs anchor the script paths with `${CURSOR_PLUGIN_ROOT}`.
The host has to expand that variable; an installer that copies the config
verbatim into `~/.cursor/mcp.json` or `~/.cursor/hooks/` produces a server that
cannot start and hooks that never fire — see
[docs/issues](docs/issues/2026-09-02-marketplace-install-hooks-and-mcp.md).

## Skills

- [skills/handoff/SKILL.md](skills/handoff/SKILL.md) — replace the bounded handoff snapshot
- [skills/handoff/scripts/](skills/handoff/scripts/) — store, hooks, and MCP entry points

## Rules

- [rules/handoff.mdc](rules/handoff.mdc) — keep handoff current at durable boundaries; never hook follow-up loops

## Commands

- [commands/handoff.md](commands/handoff.md) — user-invoked snapshot replace

## MCP

- [mcp-cursor.json](mcp-cursor.json) — `get_handoff`, `write_handoff` (full replace, max 8000 chars, compare-and-swap `expected_revision`)
- [mcp.json](mcp.json) and [mcp-claude.json](mcp-claude.json) — same server for the Agent Plugins standard (`${PLUGIN_ROOT}`) and Claude (`${CLAUDE_PLUGIN_ROOT}`)

The server has no workspace of its own, so it asks the client for one through
MCP `roots/list`. Resolution order: `MAC_SCOPE`, client roots, `process.cwd()`.

## Hooks

- [hooks/hooks-cursor.json](hooks/hooks-cursor.json) — inject `[MULTIAGENT HANDOFF]` on session start; journal prompt hash and stop status; never `followup_message`

## Local state

Runtime data lives in the **consuming workspace** (gitignored there):

```text
.cursor/multiagent-coordinator/
├─ handoff.md
├─ events.jsonl
└─ sessions/
```

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
