import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
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

/**
 * Answers server-initiated requests (roots/list) while collecting replies to
 * our own calls, so stdin has to stay open for the whole exchange.
 */
function talkToServer({ messages, cwd, env, answer, expectedId }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [serverPath], { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
    const replies = [];
    const requests = [];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Wait for the child to exit, otherwise Windows keeps its cwd locked
      // while the test removes the temporary directories.
      child.once("exit", () => (error ? reject(error) : resolve({ replies, requests })));
      child.stdin.end();
      child.kill("SIGKILL");
    };

    child.stdout.on(
      "data",
      createFramedReader((message) => {
        if (message.method !== undefined && message.id !== undefined) {
          requests.push(message);
          child.stdin.write(encodeMessage({ jsonrpc: "2.0", id: message.id, result: answer(message) }));
          return;
        }
        replies.push(message);
        if (message.id === expectedId) finish();
      })
    );
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish(error));

    for (const message of messages) child.stdin.write(message);

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

test("MCP takes the workspace from client roots instead of cwd", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "mac-roots-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "mac-cwd-"));
  try {
    const { replies, requests } = await talkToServer({
      cwd: elsewhere,
      env: { MAC_SCOPE: "", MAC_STATE_DIR: "" },
      messages: [
        rpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: { roots: { listChanged: true } },
          clientInfo: { name: "test", version: "0" }
        }),
        rpc("tools/call", { name: "write_handoff", arguments: { content: "# Handoff\n\n## Goal\nRoots" } }, 2)
      ],
      answer: () => ({ roots: [{ uri: pathToFileURL(workspace).href, name: "test-workspace" }] }),
      expectedId: 2
    });

    assert.deepEqual(requests.map((request) => request.method), ["roots/list"]);
    assert.equal(JSON.parse(replies.at(-1).result.content[0].text).status, "updated");
    assert.ok(existsSync(join(workspace, ".cursor", "multiagent-coordinator", "handoff.md")));
    assert.ok(!existsSync(join(elsewhere, ".cursor")));
  } finally {
    // Windows keeps the killed child's cwd busy for a moment.
    const cleanup = { recursive: true, force: true, maxRetries: 20, retryDelay: 50 };
    rmSync(workspace, cleanup);
    rmSync(elsewhere, cleanup);
  }
});
