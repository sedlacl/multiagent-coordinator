import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFramedReader, encodeMessage } from "../lib/mcp-stdio.js";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(scriptsDir, "..", "mcp-server.js");

function rpc(method, params, id = 1) {
  const msg = { jsonrpc: "2.0", method };
  if (id !== null) msg.id = id;
  if (params !== undefined) msg.params = params;
  return encodeMessage(msg);
}

function callServer(messages, env, expectedReplies) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const replies = [];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (error) reject(error);
      else resolve(replies);
    };
    const onMessage = (message) => {
      replies.push(message);
      if (replies.length >= expectedReplies) finish();
    };
    child.stdout.on("data", createFramedReader(onMessage));
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish(error));

    for (const message of messages) child.stdin.write(message);
    child.stdin.end();

    const timer = setTimeout(() => {
      finish(new Error(`MCP server timed out; replies=${JSON.stringify(replies)}`));
    }, 5000);
  });
}

test("MCP lists tools and writes handoff with revision", async () => {
  const root = mkdtempSync(join(tmpdir(), "mac-mcp-"));
  try {
    const replies = await callServer(
      [
        rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } }),
        rpc("tools/list", {}, 2),
        rpc(
          "tools/call",
          { name: "write_handoff", arguments: { content: "# Handoff\n\n## Goal\nMCP" } },
          3
        ),
        rpc("tools/call", { name: "get_handoff", arguments: {} }, 4)
      ],
      { MAC_SCOPE: root },
      4
    );

    const byId = Object.fromEntries(replies.filter((r) => r.id !== undefined).map((r) => [r.id, r]));
    assert.equal(byId[1].result.serverInfo.name, "multiagent-coordinator");
    assert.deepEqual(
      byId[2].result.tools.map((tool) => tool.name).sort(),
      ["get_handoff", "write_handoff"]
    );
    const written = JSON.parse(byId[3].result.content[0].text);
    assert.equal(written.status, "updated");
    const read = JSON.parse(byId[4].result.content[0].text);
    assert.match(read.content, /## Goal/);
    assert.equal(read.revision, written.revision);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
