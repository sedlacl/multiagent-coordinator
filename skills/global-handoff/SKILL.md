---
name: global-handoff
description: Save or update a named global handoff available across workspaces. Use as /global-handoff <name>.
disable-model-invocation: true
---

# Save named global handoff

`/global-handoff <name>` saves a compact transferable checkpoint outside the current workspace so another project/session can pick it up.

Global handoffs live under `~/.multiagent-coordinator/handoffs/<name>.md` through MCP.

## Steps

1. Require a handoff name. If none was supplied, ask for one; do not invent it.
2. Call MCP `get_global_handoff` with that name and keep its `revision`.
3. Build a full replacement from the current conversation plus any still-valid old snapshot. Write it so it remains understandable from another workspace. Include project-specific paths only when they are useful context.
4. Call MCP `write_global_handoff` with `name`, full replacement `content`, and `expected_revision`.
5. On revision conflict, reload, merge still-valid state, and retry once.
6. Reply briefly that the global handoff was saved.

## Template

```markdown
# Global handoff: <name>

## Goal
## Context
## Confirmed facts
## Decisions
## Constraints
## Useful references
## Next actions
## Origin workspace
```

Maximum 8000 characters. No secrets, full prompts, transcripts, or tool dumps.
