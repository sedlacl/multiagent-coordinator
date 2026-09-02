# Changelog — multiagent-coordinator

All notable changes to this plugin are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Fixed

- Hook and MCP configs anchor the script paths with the host's plugin-root variable (`${CURSOR_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_ROOT}`, `${PLUGIN_ROOT}`). Workspace-relative paths only resolved when the opened project was this repository, so an installed plugin could not spawn the MCP server and its hooks never fired.
- The MCP server resolves the workspace through MCP `roots/list` instead of relying on `process.cwd()`, which pointed at the home directory for a user-level server. Order: `MAC_SCOPE`, client roots, `process.cwd()`.

## [0.1.0] - 2026-09-01

### Added

- Initial plugin with skill `handoff`, always-applied rule `handoff`, command `/handoff`, Cursor hooks, and stdio MCP (`get_handoff` / `write_handoff`)
