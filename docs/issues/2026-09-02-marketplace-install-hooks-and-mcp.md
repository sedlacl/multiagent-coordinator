# Marketplace install leaves hooks inactive and MCP unable to start

Status: plugin side fixed, installer side open
Reported: 2026-09-02
Affected: `multiagent-coordinator` 0.1.0 installed into `~/.cursor` by a marketplace installer that tracks its state in `~/.cursor/mcp/.uu-marketplace-managed.json` (Windows)

## Symptom

The MCP server never connects and no hook ever fires, while skills, rules, and commands work.

```text
[Shared MCP process] Error: Cannot find module
  'C:\Users\<user>\skills\handoff\scripts\mcp-server.js'
[Shared MCP process] Connection failed: MCP error -32000: Connection closed
[MCPService] createClient completed for server: user-multiagent-coordinator, connected=false
```

## What the installer produced

| Component | Destination | Active |
| --------- | ----------- | ------ |
| skills | `~/.cursor/skills/<source>/<plugin>/handoff/` | yes |
| rules | `~/.cursor/rules/<source>/<plugin>/handoff.mdc` | yes |
| commands | `~/.cursor/commands/<source>/<plugin>/handoff.md` | yes |
| hooks | `~/.cursor/hooks/<source>/<plugin>/hooks-cursor.json` | **no** |
| MCP | `~/.cursor/mcp/<source>/<plugin>/mcp.json` plus an entry merged into `~/.cursor/mcp.json` | **no** |

## Root cause

Two independent problems, both about paths and registration:

1. **Hooks are staged but never registered.** Cursor reads hooks only from `~/.cursor/hooks.json`, `<workspace>/.cursor/hooks.json`, and plugin-managed hook configs. A copy under `~/.cursor/hooks/<source>/<plugin>/hooks-cursor.json` is not read by anything.
2. **MCP config is copied verbatim.** The plugin shipped a workspace-relative script path. The user-level MCP server is spawned from the home directory, so `skills/handoff/scripts/mcp-server.js` resolved to `C:\Users\<user>\skills\...`. After installation the script is not at that relative location either: the `skills/` level is dropped and the path is `~/.cursor/skills/<source>/<plugin>/handoff/scripts/mcp-server.js`.

A third, less visible problem: the MCP server derived the workspace root from `process.cwd()`. For a user-level server that is the home directory, so even a spawnable server would have written `handoff.md` outside the project.

## Confirmed installer behaviour

Re-running the install after the first fix attempt produced
`Cannot find module 'C:\Users\<user>\${PLUGIN_ROOT}\skills\handoff\scripts\mcp-server.js'`, which pins down two more facts:

- The installer re-reads the plugin from its source directory (the installed `mcp-server.js` already contained the new `roots/list` code) but ignores the manifest's `mcpServers` path: `.cursor-plugin/plugin.json` pointed at `mcp-cursor.json` while the copied entry came from the root `mcp.json`. The manifest's `hooks` path *is* honoured.
- Config copied into the user scope is plain user config, not a plugin, so **no** plugin-root variable is expanded there — neither `${PLUGIN_ROOT}` nor `${CURSOR_PLUGIN_ROOT}`. Only `${userHome}`, `${workspaceFolder}`, and `${env:NAME}` work in `~/.cursor/mcp.json`.

## Plugin-side fix (done)

- `mcp-cursor.json` (referenced from `.cursor-plugin/plugin.json`) anchors the script with `${CURSOR_PLUGIN_ROOT}` and `mcp-claude.json` uses `${CLAUDE_PLUGIN_ROOT}`, for hosts that load the plugin properly.
- The root `mcp.json` — the file this installer copies — uses `${userHome}/.cursor/skills/multiagent-coordinator/multiagent-coordinator/handoff/scripts/mcp-server.js`, so the merged user-level entry spawns. It hardcodes the installer's `<source>/<plugin>` layout, which is the price of the verbatim copy.
- `hooks/hooks-user.json` holds the same three events with paths relative to `~/.cursor/`, ready to merge into `~/.cursor/hooks.json`. Merging it by hand is currently the only way to make the hooks fire.
- `hooks/hooks-cursor.json` anchors all three hook commands with `${CURSOR_PLUGIN_ROOT}`. Plugin hook commands run from the opened project, so relative paths silently no-op.
- The MCP server now asks the client for its workspace through `roots/list` and invalidates the cached root on `notifications/roots/list_changed`. Precedence is `MAC_SCOPE`, then client roots, then `process.cwd()`.

The repository keeps its own `.cursor/hooks.json` and `.cursor/mcp.json` with workspace-relative paths; those are project-scoped and correct for developing in this repo.

## Installer-side request (open)

When installing a Cursor plugin that ships hooks or MCP servers:

1. Merge the plugin's hook events into the user-level `~/.cursor/hooks.json` (preserving unrelated hooks), or register the plugin directory so Cursor loads it as a plugin.
2. Rewrite plugin-relative paths to the actual install directory, or expand `${CURSOR_PLUGIN_ROOT}` to it, in both hook commands and MCP `args`.
3. Report the merge result during install, so a staged-but-inactive component is not mistaken for a successful install.

Preferred alternative: install into `~/.cursor/plugins/` (or return the path from a `workspaceOpen` hook) and let Cursor load the plugin manifest, which handles variable expansion and hook registration natively.

## Verification

- `node --test skills/handoff/scripts/tests/*.test.js` (12 tests) covers the roots-based workspace resolution.
- After a marketplace install: MCP logs show `multiagent-coordinator` connected, `get_handoff` works, and the Hooks output channel shows `sessionStart` firing.
- A stale broken entry may remain in `~/.cursor/mcp.json` from an earlier install; remove it before retesting.
