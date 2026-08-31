# multiagent-coordinator

Lightweight coordination state for Cursor agents and subagents via hooks and MCP.

The project is intentionally small. Its first goal is to make coordination state durable across Cursor sessions without turning coordination into another source of model/tool-call loops.

## V0 principles

- **Human-readable handoff state** stored inside the workspace.
- **Hooks push small deltas** into model context only at existing execution boundaries.
- **MCP is pull-based** and used when an agent explicitly needs shared state.
- **No LLM coordinator** in the infrastructure layer.
- **No automatic follow-up loops** from hooks.
- **Bounded context injection** to avoid replacing conversation bloat with coordination bloat.
- **Fail-open hooks**: coordination failure must not break normal Cursor work.

## Local state

Runtime coordination data lives under:

```text
.cursor/multiagent-coordinator/
├─ handoff.md
├─ events.jsonl
└─ sessions/
```

The whole directory is gitignored.

`handoff.md` is the durable, human-readable source of truth that another agent or session can inspect directly. It should contain only the compact current state needed to resume work: goal, confirmed facts, decisions, active/queued work, blockers, verification state, and next actions.

`events.jsonl` is only a lightweight machine-readable journal for hook-level deltas. It is not the primary handoff format and does not replace `handoff.md`.

## V0 flow

```text
Cursor session A                    Cursor session B
      |                                  |
      | significant state change         | new session
      v                                  v
     hook ---------------------> .cursor/multiagent-coordinator/
                                      |
                                      +-- handoff.md
                                      +-- events.jsonl
                                      +-- session cursors
                                      |
                                MCP stdio server
                                      |
                               explicit read/write
```

Hooks should avoid creating extra model/tool-call loops. Where possible they return a short `additional_context` delta as part of an existing Cursor execution boundary.

`sessionStart` reads `handoff.md` and injects a bounded snapshot into the new session.

The MCP layer is intended for explicit cross-session access to the same text-based state, not as a mandatory hop for every coordination event.

## Requirements

- Node.js >= 22.13
- Cursor with project hooks and MCP support

## Development

```bash
npm install
npm run build
npm test
```

## Configuration

By default state is stored in the current workspace under `.cursor/multiagent-coordinator/`.

Override the state directory with `MAC_STATE_DIR` if needed. `MAC_SCOPE` can be used to override workspace-root resolution.

## Current non-goals

V0 deliberately does **not** implement scheduling, workstream dependency graphs, leases, semantic memory, embeddings, an LLM classifier, or autonomous orchestration. Those can be added incrementally after the basic coordination path proves stable.
