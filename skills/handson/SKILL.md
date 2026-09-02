---
name: handson
description: Load a named workspace handoff into the current conversation. Use as /handson <name>, or /handson to list available handoffs.
disable-model-invocation: true
---

# Load named workspace handoff

`/handson <name>` picks up a previously saved workspace checkpoint.

## Steps

1. If a name was supplied, call MCP `get_handoff` with that name. Confirm `workspace` is the opened project. Treat the returned content as transferred working context for this conversation.
2. If no name was supplied, call MCP `list_handoffs` and show the available names concisely. Ask which one the user wants. Do not load one automatically.
3. After loading, summarize only what is needed to continue: Goal, current state/blockers, and Next actions. Do not rewrite the handoff merely because it was read.

`/handson` is read-only. It does not update, merge, or synchronize handoffs.
