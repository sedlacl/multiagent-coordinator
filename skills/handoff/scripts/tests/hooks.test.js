import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CoordinationStore } from "../lib/store.js";

const hooksDir = dirname(fileURLToPath(import.meta.url));

function runHook(scriptName, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(hooksDir, "..", "hooks", scriptName)], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${scriptName} exited ${code}: ${stderr}`));
        return;
      }
      resolve(stdout.trim() ? JSON.parse(stdout) : {});
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test("sessionStart injects handoff as additional_context", async () => {
  const root = mkdtempSync(join(tmpdir(), "mac-hook-"));
  try {
    new CoordinationStore(root).writeHandoff("# Handoff\n\n## Goal\nHook smoke");
    const output = await runHook("session-start.js", { cwd: root, session_id: "s1" });
    assert.match(output.additional_context, /\[MULTIAGENT HANDOFF\]/);
    assert.match(output.additional_context, /Hook smoke/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stop records SESSION_STOP and never returns followup_message", async () => {
  const root = mkdtempSync(join(tmpdir(), "mac-stop-"));
  try {
    const output = await runHook("stop.js", { cwd: root, status: "completed", session_id: "s2" });
    assert.equal("followup_message" in output, false);
    const events = new CoordinationStore(root).recentEvents();
    assert.equal(events.at(-1).kind, "SESSION_STOP");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
