import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CoordinationStore,
  HANDOFF_MAX_CHARS,
  HandoffConflictError
} from "../lib/store.js";

function workspace() {
  return mkdtempSync(join(tmpdir(), "multiagent-coordinator-"));
}

test("writes and reads a normalized handoff with a stable revision", () => {
  const root = workspace();
  try {
    const store = new CoordinationStore(root);
    const first = store.writeHandoff("# Handoff\n\n## Goal\nShip it\n\n");
    const read = store.getHandoffSnapshot();

    assert.equal(read.content, "# Handoff\n\n## Goal\nShip it");
    assert.equal(read.revision, first.revision);
    assert.match(read.revision, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a stale compare-and-swap write and preserves the newer handoff", () => {
  const root = workspace();
  try {
    const sessionA = new CoordinationStore(root);
    const sessionB = new CoordinationStore(root);

    const base = sessionA.getHandoffSnapshot();
    const a = sessionA.writeHandoff("state from A", base.revision);

    assert.throws(
      () => sessionB.writeHandoff("stale state from B", base.revision),
      (error) => {
        assert.ok(error instanceof HandoffConflictError);
        assert.equal(error.expectedRevision, base.revision);
        assert.equal(error.currentRevision, a.revision);
        return true;
      }
    );

    assert.equal(sessionB.getHandoff(), "state from A");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows a refreshed session to write after a conflict", () => {
  const root = workspace();
  try {
    const a = new CoordinationStore(root);
    const b = new CoordinationStore(root);

    const initial = a.getHandoffSnapshot();
    a.writeHandoff("A1", initial.revision);
    const refreshed = b.getHandoffSnapshot();
    const written = b.writeHandoff("A1 + B1", refreshed.revision);

    assert.equal(a.getHandoff(), "A1 + B1");
    assert.equal(a.getHandoffSnapshot().revision, written.revision);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects oversized handoff without changing the existing file", () => {
  const root = workspace();
  try {
    const store = new CoordinationStore(root);
    const base = store.writeHandoff("keep me");

    assert.throws(
      () => store.writeHandoff("x".repeat(HANDOFF_MAX_CHARS + 1), base.revision),
      /handoff exceeds/
    );
    assert.equal(store.getHandoff(), "keep me");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic write leaves no temporary handoff files behind", () => {
  const root = workspace();
  try {
    const store = new CoordinationStore(root);
    store.writeHandoff("atomic");

    const stateDir = join(root, ".cursor", "multiagent-coordinator");
    assert.equal(readFileSync(join(stateDir, "handoff.md"), "utf8"), "atomic\n");
    assert.deepEqual(
      readdirSync(stateDir).filter((name) => name.startsWith(".handoff.") && name.endsWith(".tmp")),
      []
    );
    assert.equal(readdirSync(stateDir).includes("handoff.lock"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
