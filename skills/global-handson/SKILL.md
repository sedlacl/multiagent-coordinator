---
name: global-handson
description: Load a named global handoff into the current conversation. Use as /global-handson <name>, or /global-handson to list available global handoffs.
disable-model-invocation: true
---

# Load named global handoff

`/global-handson <name>` picks up a checkpoint saved from any workspace.

## Steps

1. If a name was supplied, call MCP `get_global_handoff` with that name and treat the returned content as transferred working context for this conversation.
2. If no name was supplied, call MCP `list_global_handoffs`, show the names concisely, and ask which one the user wants. Do not load one automatically.
3. After loading, summarize only the Goal/Context, current blockers, and Next actions needed to continue.

`/global-handson` is read-only. It does not rewrite or synchronize the handoff.
