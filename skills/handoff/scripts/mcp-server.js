import { resolveWorkspaceRoot, sessionIdFrom } from "./lib/context.js";
import { createFramedReader, encodeMessage } from "./lib/mcp-stdio.js";
import {
  CoordinationStore,
  GlobalHandoffStore,
  HANDOFF_MAX_CHARS,
  HANDOFF_NAME_MAX_CHARS,
  HandoffConflictError
} from "./lib/store.js";

const SERVER_INFO = { name: "multiagent-coordinator", version: "0.4.0" };
const PROTOCOL_VERSION = "2024-11-05";

const nameSchema = {
  type: "string",
  minLength: 1,
  maxLength: HANDOFF_NAME_MAX_CHARS,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$",
  description: "Named handoff key, e.g. OOM or release-T1"
};

function listTool(name, global = false) {
  return {
    name,
    description: global
      ? "List named global handoffs available across workspaces."
      : "List named handoffs available in the current workspace.",
    inputSchema: { type: "object", properties: {} }
  };
}

function getTool(name, global = false) {
  return {
    name,
    description: global
      ? "Read one named global handoff and its revision."
      : "Read one named handoff from the current workspace and its revision.",
    inputSchema: {
      type: "object",
      properties: { name: nameSchema },
      required: ["name"]
    }
  };
}

function writeTool(name, global = false) {
  return {
    name,
    description: `${global ? "Replace a named global" : "Replace a named workspace"} handoff (max ${HANDOFF_MAX_CHARS} chars). Pass expected_revision from the matching get tool; stale writes fail.`,
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        content: { type: "string", maxLength: HANDOFF_MAX_CHARS },
        expected_revision: {
          type: "string",
          minLength: 64,
          maxLength: 64,
          description: "Revision returned by the matching get tool. Omit only for an intentional unconditional write."
        }
      },
      required: ["name", "content"]
    }
  };
}

const TOOLS = [
  listTool("list_handoffs"),
  getTool("get_handoff"),
  writeTool("write_handoff"),
  listTool("list_global_handoffs", true),
  getTool("get_global_handoff", true),
  writeTool("write_global_handoff", true)
];

const ROOTS_TIMEOUT_MS = 1500;
const UNRESOLVED_WORKSPACE =
  "Cannot resolve workspace: MAC_SCOPE is unset and the client did not provide MCP roots. Refusing to access workspace handoffs from process.cwd().";
const pendingRequests = new Map();
let nextRequestId = 1;
let clientSupportsRoots = false;
let clientInfo = null;

function sendRequest(method, timeoutMs = ROOTS_TIMEOUT_MS) {
  const id = `mac-${nextRequestId++}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(null);
    }, timeoutMs);
    timer.unref?.();
    pendingRequests.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    send({ jsonrpc: "2.0", id, method });
  });
}

async function workspaceRoot() {
  if (process.env.MAC_SCOPE?.trim()) return resolveWorkspaceRoot({});
  if (clientSupportsRoots) {
    const response = await sendRequest("roots/list");
    const uri = response?.result?.roots?.[0]?.uri;
    if (typeof uri === "string" && uri.trim()) return resolveWorkspaceRoot({ workspace_roots: [uri] });
  }
  throw new Error(UNRESOLVED_WORKSPACE);
}

async function workspaceStore() {
  return new CoordinationStore(await workspaceRoot());
}

function sessionIdFromCall(params) {
  const meta = params?._meta;
  if (meta && typeof meta === "object") {
    const fromMeta = sessionIdFrom(meta);
    if (fromMeta) return fromMeta;
  }
  return sessionIdFrom(params ?? {});
}

function textResult(payload, isError = false) {
  return {
    isError,
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }]
  };
}

function conflictResult(error) {
  return textResult(
    {
      status: "conflict",
      expected_revision: error.expectedRevision,
      current_revision: error.currentRevision,
      action: "Read the handoff again, merge current state, then retry with the new revision."
    },
    true
  );
}

async function callTool(name, args = {}, params = {}) {
  try {
    if (name === "list_handoffs") {
      const store = await workspaceStore();
      return textResult({ workspace: store.workspaceRoot, handoffs: store.listNamedHandoffs() });
    }
    if (name === "get_handoff") {
      const store = await workspaceStore();
      const snapshot = store.getNamedHandoffSnapshot(args.name);
      return textResult({
        workspace: store.workspaceRoot,
        name: args.name,
        revision: snapshot.revision,
        content: snapshot.content || "(empty handoff)"
      });
    }
    if (name === "write_handoff") {
      if (typeof args.content !== "string") return textResult("content must be a string", true);
      const store = await workspaceStore();
      const written = store.writeNamedHandoff(args.name, args.content, args.expected_revision);
      store.appendEvent(
        "HANDOFF_WRITE",
        JSON.stringify({ name: args.name, chars: args.content.trim().length, revision: written.revision, workspace: store.workspaceRoot }),
        sessionIdFromCall(params)
      );
      return textResult({
        status: "updated",
        name: args.name,
        revision: written.revision,
        workspace: store.workspaceRoot,
        handoff_path: store.namedHandoffPath(args.name)
      });
    }

    const globalStore = new GlobalHandoffStore();
    if (name === "list_global_handoffs") {
      return textResult({ scope: "global", handoffs: globalStore.listHandoffs() });
    }
    if (name === "get_global_handoff") {
      const snapshot = globalStore.getHandoffSnapshot(args.name);
      return textResult({ scope: "global", name: args.name, revision: snapshot.revision, content: snapshot.content || "(empty handoff)" });
    }
    if (name === "write_global_handoff") {
      if (typeof args.content !== "string") return textResult("content must be a string", true);
      const written = globalStore.writeHandoff(args.name, args.content, args.expected_revision);
      return textResult({
        status: "updated",
        scope: "global",
        name: args.name,
        revision: written.revision,
        handoff_path: globalStore.handoffPath(args.name)
      });
    }

    return textResult(`Unknown tool: ${name}`, true);
  } catch (error) {
    if (error instanceof HandoffConflictError) return conflictResult(error);
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function dispatch(message) {
  if (!message || typeof message !== "object") return null;
  const { id, method, params } = message;
  if (method === "initialize") {
    clientSupportsRoots = Boolean(params?.capabilities?.roots);
    clientInfo = params?.clientInfo && typeof params.clientInfo === "object" ? params.clientInfo : null;
    const requested = params?.protocolVersion;
    return rpcResult(id, {
      protocolVersion: typeof requested === "string" && requested ? requested : PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    });
  }
  if (method === "notifications/initialized" || method === "initialized" || method === "notifications/roots/list_changed") return null;
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") return rpcResult(id, await callTool(params?.name, params?.arguments ?? {}, params));
  if (id !== undefined) return rpcError(id, -32601, `Method not found: ${method}`);
  return null;
}

function send(obj) {
  process.stdout.write(encodeMessage(obj));
}

let queue = Promise.resolve();
process.stdin.on(
  "data",
  createFramedReader((message) => {
    if (message?.method === undefined && message?.id !== undefined && pendingRequests.has(message.id)) {
      const settle = pendingRequests.get(message.id);
      pendingRequests.delete(message.id);
      settle(message);
      return;
    }
    queue = queue.then(async () => {
      try {
        const response = await dispatch(message);
        if (response) send(response);
      } catch (error) {
        const text = error instanceof Error ? error.stack ?? error.message : String(error);
        process.stderr.write(`[multiagent-coordinator] ${text}\n`);
        if (message?.id !== undefined) send(rpcError(message.id, -32603, error instanceof Error ? error.message : String(error)));
      }
    });
  })
);
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
