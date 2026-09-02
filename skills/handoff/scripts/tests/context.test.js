import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderHandoff, renderSession, resolveWorkspaceRoot } from "../lib/context.js";

test("strips POSIX drive prefix so Windows roots are not doubled", () => {
  const previous = process.env.MAC_SCOPE;
  delete process.env.MAC_SCOPE;
  try {
    const root = resolveWorkspaceRoot({ workspace_roots: ["/R:/External/multiagent-coordinator"] });
    assert.match(root, /[\\/]External[\\/]multiagent-coordinator$/i);
    assert.doesNotMatch(root, /R:[\\/]+R:/i);
  } finally {
    if (previous === undefined) delete process.env.MAC_SCOPE;
    else process.env.MAC_SCOPE = previous;
  }
});

test("MAC_SCOPE wins over workspace_roots", () => {
  const dir = mkdtempSync(join(tmpdir(), "mac-scope-"));
  const previous = process.env.MAC_SCOPE;
  process.env.MAC_SCOPE = dir;
  try {
    assert.equal(resolveWorkspaceRoot({ workspace_roots: ["/R:/other"] }), dir);
  } finally {
    if (previous === undefined) delete process.env.MAC_SCOPE;
    else process.env.MAC_SCOPE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderHandoff wraps a bounded snapshot", () => {
  const text = renderHandoff("## Goal\nShip", 40);
  assert.match(text, /^\[MULTIAGENT HANDOFF\]/);
  assert.match(text, /## Goal/);
});

test("renderSession emits a locator line", () => {
  assert.equal(renderSession("abc-123"), "[MULTIAGENT SESSION] abc-123");
  assert.equal(renderSession(null), "");
});
