---
name: handoff
description: Replace workspace coordination snapshot in handoff.md when user requests a handoff update.
disable-model-invocation: true
---

# Handoff snapshot

User-invoked replace of `.cursor/multiagent-coordinator/handoff.md`. Do this immediately; do not wait for end of turn or extra confirmation.

**Runtime skill root** = absolute directory that contains **this** `SKILL.md`. Hook and MCP entry points live in `scripts/` (portable Node.js, `node >= 18`).

## Steps

1. Read current state with MCP `get_handoff`. Keep the returned `revision`. Confirm `workspace` is this opened project; if it is a different directory, stop and report the mismatch — do not write. If MCP is missing, read `.cursor/multiagent-coordinator/handoff.md` directly. Empty handoff is fine.
2. Build a **full replacement** from this conversation plus the old snapshot. Keep what is still true; drop stale items. Do not append a log. Under **Sessions**, put this conversation's session id first (from `[MULTIAGENT SESSION]` if present). Keep at most five ids; drop ones that no longer matter. Ids only — never paste transcripts.
3. Write with MCP `write_handoff`, passing the revision from step 1 as `expected_revision`. Max 8000 characters. Confirm `workspace` (and `handoff_path` if present) still match this project.
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

## Sessions

- `<session-id>`
```

Facts and decisions are bullets. Next actions are concrete. Sessions are Cursor conversation ids (the UUID of the agent transcript), newest first, at most five. No secrets, full prompts, transcripts, or tool dumps.

## Do not

- Skip the write because a hook or rule "should have" done it
- Call `get_handoff` without writing
- Blindly retry a revision conflict with an unconditional write
- Return `followup_message` from any hook
- Spawn extra agents just to write this file
