import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

function callServer(messages, env, expectedReplies, cwd) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [serverPath], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const replies = [];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.once("exit", () => (error ? reject(error) : resolve(replies)));
      child.stdin.end();
      child.kill("SIGKILL");
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
    assert.equal(written.workspace, resolve(root));
    assert.equal(written.handoff_path, join(root, ".cursor", "multiagent-coordinator", "handoff.md"));
    const read = JSON.parse(byId[4].result.content[0].text);
    assert.match(read.content, /## Goal/);
    assert.equal(read.revision, written.revision);
    assert.equal(read.workspace, resolve(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP answers newline-delimited JSON and echoes the client protocol version", async () => {
  const root = mkdtempSync(join(tmpdir(), "mac-wire-"));
  try {
    const raw = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [serverPath], { env: { ...process.env, MAC_SCOPE: root }, stdio: "pipe" });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.on("error", reject);
      child.on("close", () => resolve(out));
      // A client that speaks plain NDJSON, like Cursor.
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }
        })}\n`
      );
      child.stdin.end();
    });

    const lines = raw.split("\n").filter(Boolean);
    assert.equal(lines.length, 1, `expected one NDJSON line, got ${JSON.stringify(raw)}`);
    assert.ok(!raw.includes("Content-Length"), "MCP stdio must not use LSP-style framing");
    assert.equal(JSON.parse(lines[0]).result.protocolVersion, "2025-06-18");
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
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
    const written = JSON.parse(replies.at(-1).result.content[0].text);
    assert.equal(written.status, "updated");
    assert.equal(written.workspace, resolve(workspace));
    assert.ok(existsSync(join(workspace, ".cursor", "multiagent-coordinator", "handoff.md")));
    assert.ok(!existsSync(join(elsewhere, ".cursor")));
  } finally {
    // Windows keeps the killed child's cwd busy for a moment.
    const cleanup = { recursive: true, force: true, maxRetries: 20, retryDelay: 50 };
    rmSync(workspace, cleanup);
    rmSync(elsewhere, cleanup);
  }
});

test("MCP resolves sequential tool calls to different client roots in one process", async () => {
  const workspaceA = mkdtempSync(join(tmpdir(), "mac-root-a-"));
  const workspaceB = mkdtempSync(join(tmpdir(), "mac-root-b-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "mac-root-cwd-"));
  const roots = [workspaceA, workspaceB];
  let rootIndex = 0;
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
        rpc("tools/call", { name: "write_handoff", arguments: { content: "# Handoff\n\n## Goal\nA" } }, 2),
        rpc(
          "tools/call",
          {
            name: "write_handoff",
            arguments: { content: "# Handoff\n\n## Goal\nB" },
            _meta: { session_id: "window-b" }
          },
          3
        )
      ],
      answer: () => ({ roots: [{ uri: pathToFileURL(roots[rootIndex++]).href, name: "workspace" }] }),
      expectedId: 3
    });

    assert.deepEqual(requests.map((request) => request.method), ["roots/list", "roots/list"]);
    const byId = Object.fromEntries(replies.filter((r) => r.id !== undefined).map((r) => [r.id, r]));
    const writtenA = JSON.parse(byId[2].result.content[0].text);
    const writtenB = JSON.parse(byId[3].result.content[0].text);
    assert.equal(writtenA.workspace, resolve(workspaceA));
    assert.equal(writtenB.workspace, resolve(workspaceB));
    assert.ok(existsSync(join(workspaceA, ".cursor", "multiagent-coordinator", "handoff.md")));
    assert.ok(existsSync(join(workspaceB, ".cursor", "multiagent-coordinator", "handoff.md")));
    assert.ok(!existsSync(join(elsewhere, ".cursor")));

    const eventB = JSON.parse(
      readFileSync(join(workspaceB, ".cursor", "multiagent-coordinator", "events.jsonl"), "utf8").trim()
    );
    assert.equal(eventB.sourceSession, "window-b");
    assert.equal(JSON.parse(eventB.payload).workspace, resolve(workspaceB));
  } finally {
    const cleanup = { recursive: true, force: true, maxRetries: 20, retryDelay: 50 };
    rmSync(workspaceA, cleanup);
    rmSync(workspaceB, cleanup);
    rmSync(elsewhere, cleanup);
  }
});

test("MCP refuses I/O when workspace cannot be resolved", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "mac-unresolved-"));
  try {
    const replies = await callServer(
      [
        rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } }),
        rpc("tools/call", { name: "get_handoff", arguments: {} }, 2),
        rpc("tools/call", { name: "write_handoff", arguments: { content: "# Handoff\n\n## Goal\nNo" } }, 3)
      ],
      { MAC_SCOPE: "", MAC_STATE_DIR: "" },
      3,
      cwd
    );

    const byId = Object.fromEntries(replies.filter((r) => r.id !== undefined).map((r) => [r.id, r]));
    assert.equal(byId[2].result.isError, true);
    assert.match(byId[2].result.content[0].text, /Cannot resolve workspace/);
    assert.equal(byId[3].result.isError, true);
    assert.match(byId[3].result.content[0].text, /Cannot resolve workspace/);
    assert.ok(!existsSync(join(cwd, ".cursor")));
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});
