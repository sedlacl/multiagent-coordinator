---
name: handoff
description: Save or update a named workspace handoff from the current conversation. Use as /handoff <name>.
disable-model-invocation: true
---

# Save named workspace handoff

`/handoff <name>` saves a compact transferable checkpoint for the current workspace.

The handoff is stored under `.cursor/multiagent-coordinator/handoffs/<name>.md` through MCP. It is explicit user-driven state transfer, not automatic synchronization.

## Steps

1. Require a handoff name from the user's command, for example `OOM` in `/handoff OOM`. If no name was supplied, ask for one; do not invent it.
2. Call MCP `get_handoff` with that name. Keep the returned `revision` and confirm `workspace` is the opened project. An empty handoff is fine.
3. Build a full replacement snapshot from this conversation plus any still-valid old snapshot. Keep it compact and useful to another agent. Do not append transcript history.
4. Call MCP `write_handoff` with `name`, the full replacement `content`, and `expected_revision` from step 2.
5. On revision conflict, call `get_handoff` again, merge only still-valid state, and retry once with the new revision. Never silently overwrite concurrent state.
6. Reply briefly that `<name>` was saved and mention the next useful action only.

## Template

```markdown
# Handoff: <name>

## Goal
## Confirmed facts
## Decisions
## Active work
## Blockers
## Verification
## Next actions
```

Maximum 8000 characters. No secrets, full prompts, transcripts, or tool dumps.

## Do not

- Update handoffs automatically without a user request
- Create extra model/tool loops just to keep a handoff current
- Blindly overwrite a revision conflict
- Spawn another agent just to save the handoff
