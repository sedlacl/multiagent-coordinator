import { resolveWorkspaceRoot, sessionIdFrom } from "./lib/context.js";
import { createFramedReader, encodeMessage } from "./lib/mcp-stdio.js";
import { CoordinationStore, HANDOFF_MAX_CHARS, HandoffConflictError } from "./lib/store.js";

const SERVER_INFO = { name: "multiagent-coordinator", version: "0.2.0" };
const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "get_handoff",
    description:
      "Read the current compact coordination state and revision from handoff.md. Keep the revision and pass it to write_handoff to avoid overwriting another session.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "write_handoff",
    description: `Replace handoff.md with compact current state (max ${HANDOFF_MAX_CHARS} chars). Pass expected_revision from get_handoff; stale writes fail instead of overwriting another session.`,
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          maxLength: HANDOFF_MAX_CHARS,
          description: "Full replacement markdown for handoff.md"
        },
        expected_revision: {
          type: "string",
          minLength: 64,
          maxLength: 64,
          description: "Revision returned by get_handoff. Omit only for an intentional unconditional write."
        }
      },
      required: ["content"]
    }
  }
];

const ROOTS_TIMEOUT_MS = 1500;
const UNRESOLVED_WORKSPACE =
  "Cannot resolve workspace: MAC_SCOPE is unset and the client did not provide MCP roots. Refusing to read or write handoff.md from process.cwd().";
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

/**
 * A user-scope server is shared across Cursor windows, so never cache the
 * root. MAC_SCOPE wins; otherwise ask for roots on every tool call. There is
 * no cwd fallback — guessing a directory is worse than an error.
 */
async function workspaceRoot() {
  if (process.env.MAC_SCOPE?.trim()) return resolveWorkspaceRoot({});

  if (clientSupportsRoots) {
    const response = await sendRequest("roots/list");
    const uri = response?.result?.roots?.[0]?.uri;
    if (typeof uri === "string" && uri.trim()) {
      return resolveWorkspaceRoot({ workspace_roots: [uri] });
    }
  }

  throw new Error(UNRESOLVED_WORKSPACE);
}

async function store() {
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

async function callTool(name, args = {}, params = {}) {
  if (name === "get_handoff") {
    try {
      const next = await store();
      const snapshot = next.getHandoffSnapshot();
      return textResult({
        workspace: next.workspaceRoot,
        revision: snapshot.revision,
        content: snapshot.content || "(empty handoff)"
      });
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), true);
    }
  }

  if (name === "write_handoff") {
    const content = args.content;
    if (typeof content !== "string") {
      return textResult("content must be a string", true);
    }
    try {
      const next = await store();
      const written = next.writeHandoff(content, args.expected_revision);
      next.appendEvent(
        "HANDOFF_WRITE",
        JSON.stringify({
          chars: content.trim().length,
          revision: written.revision,
          workspace: next.workspaceRoot,
          client: clientInfo
        }),
        sessionIdFromCall(params)
      );
      return textResult({
        status: "updated",
        revision: written.revision,
        workspace: next.workspaceRoot,
        handoff_path: next.handoffPath
      });
    } catch (error) {
      if (error instanceof HandoffConflictError) {
        return textResult(
          {
            status: "conflict",
            expected_revision: error.expectedRevision,
            current_revision: error.currentRevision,
            action: "Call get_handoff, merge current state, then retry write_handoff with the new revision."
          },
          true
        );
      }
      return textResult(error instanceof Error ? error.message : String(error), true);
    }
  }

  return textResult(`Unknown tool: ${name}`, true);
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

  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  if (method === "notifications/roots/list_changed") {
    return null;
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const result = await callTool(name, args, params);
    return rpcResult(id, result);
  }

  if (id !== undefined) {
    return rpcError(id, -32601, `Method not found: ${method}`);
  }
  return null;
}

function send(obj) {
  process.stdout.write(encodeMessage(obj));
}

let queue = Promise.resolve();
process.stdin.on(
  "data",
  createFramedReader((message) => {
    // Settle our own client requests outside the queue; a queued tool call may
    // be awaiting this reply.
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
        const messageText = error instanceof Error ? error.stack ?? error.message : String(error);
        process.stderr.write(`[multiagent-coordinator] ${messageText}\n`);
        if (message?.id !== undefined) {
          send(rpcError(message.id, -32603, error instanceof Error ? error.message : String(error)));
        }
      }
    });
  })
);

process.stdin.on("end", () => {
  process.exit(0);
});
process.stdin.resume();
