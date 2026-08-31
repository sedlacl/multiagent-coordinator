# multiagent-coordinator

Lightweight coordination state for Cursor agents and subagents via hooks and MCP.

The project is intentionally small. Its first goal is to make coordination state durable across Cursor sessions without turning coordination into another source of model/tool-call loops.

## V0 principles

- **One shared local state store** for all agent sessions working in the same workspace.
- **Hooks push small deltas** into model context only at existing execution boundaries.
- **MCP is pull-based** and used when an agent explicitly needs the shared state.
- **No LLM coordinator** in the infrastructure layer.
- **No automatic follow-up loops** from hooks.
- **Bounded context injection** to avoid replacing conversation bloat with coordination bloat.
- **Fail-open hooks**: coordination failure must not break normal Cursor work.

## V0 flow

```text
Cursor session A                    Cursor session B
      |                                  |
      | Task completes                   | new session
      v                                  v
 postToolUse(Task)                  sessionStart
      |                                  |
      +---------- SQLite ----------------+
                    |
                    +-- compact shared state
                    +-- append-only events
                    +-- per-session event cursor
                    |
              MCP stdio server
                    |
             explicit read/write
```

`postToolUse(Task)` records a bounded subagent-result event without requiring an MCP tool call from the model. It also injects only unseen events from *other* sessions through Cursor's `additional_context` field. The current session does not receive a duplicate of its own Task output.

`sessionStart` injects a compact snapshot when a new Cursor conversation starts.

The MCP server exposes a deliberately small API for explicit state access:

- `coordinator_read`
- `coordinator_write_state`
- `coordinator_append_event`

## Requirements

- Node.js >= 22.13
- Cursor with project hooks and MCP support

The implementation uses Node's built-in `node:sqlite`, so there is no native SQLite npm dependency to build.

## Development

```bash
npm install
npm run build
npm test
```

After building, `.cursor/hooks.json` and `.cursor/mcp.json` can run the local compiled hook handlers and MCP server directly.

## State location

By default the database is stored outside the repository:

```text
~/.multiagent-coordinator/state.db
```

Override it with `MAC_DB_PATH`.

Workspace scope is resolved from `MAC_SCOPE`, Cursor's `workspace_roots`, or the current working directory, in that order.

## Current non-goals

V0 deliberately does **not** implement scheduling, workstream dependency graphs, leases, semantic memory, embeddings, an LLM classifier, or autonomous orchestration. Those can be added incrementally after the basic coordination path proves stable.
