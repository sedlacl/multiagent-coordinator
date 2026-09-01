# multiagent-coordinator

Compact cross-session coordination for Cursor agents: a workspace `handoff.md` as the source of truth, pull-based MCP, and fail-open hooks. No LLM scheduler and no hook follow-up loops.

Portable **Node.js** (`node >= 18`) — Windows, macOS, Linux. No compile step.

## Installation

Install **`multiagent-coordinator`** from the IDS Cursor marketplace (`usy_ids_cursormarketg01`).

This plugin ships:

| Component | Role |
| --------- | ---- |
| [skills/handoff/SKILL.md](skills/handoff/SKILL.md) | `/handoff` replace of `handoff.md` |
| [rules/handoff.mdc](rules/handoff.mdc) | always-applied coordination contract |
| [commands/handoff.md](commands/handoff.md) | slash command `/handoff` |
| [mcp.json](mcp.json) | stdio MCP `get_handoff` / `write_handoff` |
| [hooks/hooks-cursor.json](hooks/hooks-cursor.json) | `sessionStart`, `beforeSubmitPrompt`, `stop` |

## Skills

- [skills/handoff/SKILL.md](skills/handoff/SKILL.md) — replace the bounded handoff snapshot
- [skills/handoff/scripts/](skills/handoff/scripts/) — store, hooks, and MCP entry points

## Rules

- [rules/handoff.mdc](rules/handoff.mdc) — keep handoff current at durable boundaries; never hook follow-up loops

## Commands

- [commands/handoff.md](commands/handoff.md) — user-invoked snapshot replace

## MCP

- [mcp.json](mcp.json) — `get_handoff`, `write_handoff` (full replace, max 8000 chars, compare-and-swap `expected_revision`)

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
