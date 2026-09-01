---
name: handoff
description: >-
  Replace the workspace coordination snapshot in handoff.md from the current
  conversation. Use when the user runs /handoff, says handoff, snapshot
  coordination state, or asks to write/update the multiagent handoff.
disable-model-invocation: true
---

# Handoff snapshot

User-invoked replace of `.cursor/multiagent-coordinator/handoff.md`. Do this immediately; do not wait for end of turn or extra confirmation.

## Steps

1. Read current state with MCP `get_handoff`. Keep the returned `revision`. If MCP is missing, read the file directly. Empty handoff is fine.
2. Build a **full replacement** from this conversation plus the old snapshot. Keep what is still true; drop stale items. Do not append a log.
3. Write with MCP `write_handoff`, passing the revision from step 1 as `expected_revision`. Max 8000 characters.
4. If the MCP reports a revision conflict, call `get_handoff` again, merge the now-current handoff with the intended replacement, and retry once with the new revision. Do not silently overwrite concurrent state.
5. If MCP is missing, overwrite the file directly as a fallback.
6. Reply in the user's language: one sentence that it was replaced, plus Goal and Next actions only.

## Template

```markdown
# Handoff

## Goal
## Confirmed facts
## Decisions
## Active work
## Blockers
## Verification
## Next actions
```

Facts and decisions are bullets. Next actions are concrete. No secrets, full prompts, transcripts, or tool dumps.

## Do not

- Skip the write because a hook or rule "should have" done it
- Call `get_handoff` without writing
- Blindly retry a revision conflict with an unconditional write
- Return `followup_message` from any hook
- Spawn extra agents just to write this file
