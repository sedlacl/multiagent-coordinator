# multiagent-coordinator

Explicit transferable context for coding agents.

The project deliberately avoids autonomous orchestration. Instead it gives agents a cheap, bounded way to save and pick up named working context through skills and a lightweight MCP server.

Portable **Node.js** (`node >= 18`) — Windows, macOS, Linux. No compile step.

## Core workflow

Workspace-local handoffs:

```text
/handoff OOM
/handson OOM
```

Global handoffs available across projects:

```text
/global-handoff OOM
/global-handson OOM
```

Without a name, `/handson` and `/global-handson` list the available handoffs and let the user choose.

The model does the semantic work of building or consuming the compact snapshot. MCP is intentionally only a bounded I/O layer, so the agent does not need to explore files or reconstruct state from a long conversation.

## Skills

| Skill | Purpose |
| --- | --- |
| `handoff` | Save/update a named workspace checkpoint |
| `handson` | Load or list workspace checkpoints |
| `global-handoff` | Save/update a named checkpoint shared across projects |
| `global-handson` | Load or list global checkpoints |

Writes use compare-and-swap revisions. A stale writer must reload and merge instead of silently overwriting another session.

## MCP

The stdio MCP server exposes six tools:

```text
list_handoffs
get_handoff
write_handoff

list_global_handoffs
get_global_handoff
write_global_handoff
```

Workspace tools resolve the opened project using `MAC_SCOPE` or MCP `roots/list`. They fail closed if no workspace can be resolved. Global tools do not need a workspace root.

Workspace handoffs are stored under:

```text
<workspace>/.cursor/multiagent-coordinator/handoffs/
```

The state directory creates its own `.gitignore` containing `*`, so consuming projects do not need to modify their repository `.gitignore`.

Global handoffs are stored under:

```text
~/.multiagent-coordinator/handoffs/
```

Override locations with `MAC_STATE_DIR` and `MAC_GLOBAL_STATE_DIR` when needed.

## Hooks

Hook implementations are intentionally retained as optional/experimental infrastructure because they contain useful cross-platform and Cursor integration work already learned by the project.

They are **not enabled by the default Cursor plugin** in 0.3.0. The explicit `/handoff` → `/handson` workflow does not require session-start injection, prompt journaling, stop hooks, or automatic follow-up loops.

Reference configs remain in:

```text
hooks/hooks-cursor.json
hooks/hooks-user.json
```

They can be reintroduced later if a concrete automatic-coordination use case proves useful.

## Installation

Install **`multiagent-coordinator`** as a Cursor plugin from the marketplace that hosts it. For local development, link this repository into `~/.cursor/plugins/local/` and reload Cursor.

Plugin-managed MCP configs use `${CURSOR_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}`. User-scope installer variants remain available for installations that merge configuration directly under `~/.cursor`.

## Claude Code

Claude Code receives equivalent slash commands from `commands/`:

```text
/handoff <name>
/handson [name]
/global-handoff <name>
/global-handson [name]
```

## Development

```bash
npm test
```

On Windows PowerShell the package script invokes the test files explicitly, so no shell globbing is required.

## Design principles

- Explicit context transfer instead of hidden synchronization
- Named checkpoints instead of one global project transcript
- Compact current-state snapshots, max 8000 characters
- MCP as cheap bounded I/O, not an orchestrator
- CAS-safe concurrent writes
- No LLM scheduler
- No automatic hook follow-up loops
- Keep optional hook know-how without making it part of the default workflow

## License

MIT
