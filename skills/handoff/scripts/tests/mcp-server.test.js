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
const packageVersion = JSON.parse(
  readFileSync(join(scriptsDir, "..", "..", "..", "..", "package.json"), "utf8")
).version;

function rpc(method, params, id = 1) {
  const msg = { jsonrpc: "2.0", method };
  if (id !== null) msg.id = id;
  if (params !== undefined) msg.params = params;
  return encodeMessage(msg);
}

function callServer(messages, env, expectedReplies, cwd) {
  return new Promise((resolvePromise, reject) => {
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
      child.once("exit", () => (error ? reject(error) : resolvePromise(replies)));
      child.stdin.end();
      child.kill("SIGKILL");
    };
    child.stdout.on("data", createFramedReader((message) => {
      replies.push(message);
      if (replies.length >= expectedReplies) finish();
    }));
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish(error));
    for (const message of messages) child.stdin.write(message);
    child.stdin.end();
    const timer = setTimeout(() => finish(new Error(`MCP server timed out; replies=${JSON.stringify(replies)}`)), 5000);
  });
}

function talkToServer({ messages, cwd, env, answer, expectedId }) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [serverPath], { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
    const replies = [];
    const requests = [];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.once("exit", () => (error ? reject(error) : resolvePromise({ replies, requests })));
      child.stdin.end();
      child.kill("SIGKILL");
    };
    child.stdout.on("data", createFramedReader((message) => {
      if (message.method !== undefined && message.id !== undefined) {
        requests.push(message);
        child.stdin.write(encodeMessage({ jsonrpc: "2.0", id: message.id, result: answer(message) }));
        return;
      }
      replies.push(message);
      if (message.id === expectedId) finish();
    }));
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish(error));
    for (const message of messages) child.stdin.write(message);
    const timer = setTimeout(() => finish(new Error(`MCP server timed out; replies=${JSON.stringify(replies)}`)), 5000);
  });
}

function parseResult(reply) {
  return JSON.parse(reply.result.content[0].text);
}

test("MCP exposes named workspace and global handoff tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "mac-mcp-"));
  const globalRoot = mkdtempSync(join(tmpdir(), "mac-global-"));
  try {
    const replies = await callServer(
      [
        rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }),
        rpc("tools/list", {}, 2),
        rpc("tools/call", { name: "write_handoff", arguments: { name: "OOM", content: "# Handoff: OOM\n\n## Goal\nFix OOM" } }, 3),
        rpc("tools/call", { name: "get_handoff", arguments: { name: "OOM" } }, 4),
        rpc("tools/call", { name: "list_handoffs", arguments: {} }, 5),
        rpc("tools/call", { name: "write_global_handoff", arguments: { name: "shared", content: "global context" } }, 6),
        rpc("tools/call", { name: "list_global_handoffs", arguments: {} }, 7)
      ],
      { MAC_SCOPE: root, MAC_GLOBAL_STATE_DIR: globalRoot },
      7
    );

    const byId = Object.fromEntries(replies.filter((r) => r.id !== undefined).map((r) => [r.id, r]));
    assert.equal(byId[1].result.serverInfo.version, packageVersion);
    assert.equal(byId[1].result.protocolVersion, "2025-06-18");
    assert.deepEqual(
      byId[2].result.tools.map((tool) => tool.name).sort(),
      ["get_global_handoff", "get_handoff", "list_global_handoffs", "list_handoffs", "write_global_handoff", "write_handoff"]
    );

    const written = parseResult(byId[3]);
    assert.equal(written.name, "OOM");
    assert.equal(written.workspace, resolve(root));
    assert.equal(written.handoff_path, join(root, ".cursor", "multiagent-coordinator", "handoffs", "OOM.md"));
    const read = parseResult(byId[4]);
    assert.equal(read.revision, written.revision);
    assert.match(read.content, /Fix OOM/);
    assert.deepEqual(parseResult(byId[5]).handoffs, ["OOM"]);
    assert.deepEqual(parseResult(byId[7]).handoffs, ["shared"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(globalRoot, { recursive: true, force: true });
  }
});

test("workspace tools take the workspace from client roots instead of cwd", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "mac-roots-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "mac-cwd-"));
  try {
    const { replies, requests } = await talkToServer({
      cwd: elsewhere,
      env: { MAC_SCOPE: "", MAC_STATE_DIR: "" },
      messages: [
        rpc("initialize", { protocolVersion: "2024-11-05", capabilities: { roots: { listChanged: true } }, clientInfo: { name: "test", version: "0" } }),
        rpc("tools/call", { name: "write_handoff", arguments: { name: "roots", content: "root context" } }, 2)
      ],
      answer: () => ({ roots: [{ uri: pathToFileURL(workspace).href, name: "test-workspace" }] }),
      expectedId: 2
    });
    assert.deepEqual(requests.map((request) => request.method), ["roots/list"]);
    assert.equal(parseResult(replies.at(-1)).workspace, resolve(workspace));
    assert.ok(existsSync(join(workspace, ".cursor", "multiagent-coordinator", "handoffs", "roots.md")));
    assert.ok(!existsSync(join(elsewhere, ".cursor")));
  } finally {
    const cleanup = { recursive: true, force: true, maxRetries: 20, retryDelay: 50 };
    rmSync(workspace, cleanup);
    rmSync(elsewhere, cleanup);
  }
});

test("workspace tools fail closed without roots while global tools still work", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "mac-unresolved-"));
  const globalRoot = mkdtempSync(join(tmpdir(), "mac-global-"));
  try {
    const replies = await callServer(
      [
        rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } }),
        rpc("tools/call", { name: "get_handoff", arguments: { name: "missing" } }, 2),
        rpc("tools/call", { name: "write_global_handoff", arguments: { name: "portable", content: "works globally" } }, 3)
      ],
      { MAC_SCOPE: "", MAC_STATE_DIR: "", MAC_GLOBAL_STATE_DIR: globalRoot },
      3,
      cwd
    );
    const byId = Object.fromEntries(replies.filter((r) => r.id !== undefined).map((r) => [r.id, r]));
    assert.equal(byId[2].result.isError, true);
    assert.match(byId[2].result.content[0].text, /Cannot resolve workspace/);
    assert.equal(parseResult(byId[3]).scope, "global");
    assert.ok(!existsSync(join(cwd, ".cursor")));
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    rmSync(globalRoot, { recursive: true, force: true });
  }
});
