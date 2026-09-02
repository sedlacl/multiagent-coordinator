import { resolveWorkspaceRoot } from "./lib/context.js";
import { createFramedReader, encodeMessage } from "./lib/mcp-stdio.js";
import { CoordinationStore, HANDOFF_MAX_CHARS, HandoffConflictError } from "./lib/store.js";

const SERVER_INFO = { name: "multiagent-coordinator", version: "0.1.0" };

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
const pendingRequests = new Map();
let nextRequestId = 1;
let clientSupportsRoots = false;
let cachedRoot = null;

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
 * A globally installed server gets no workspace from the transport, so ask the
 * client for its roots. MAC_SCOPE wins; cwd stays the last-resort fallback.
 */
async function workspaceRoot() {
  if (process.env.MAC_SCOPE?.trim()) return resolveWorkspaceRoot({});
  if (cachedRoot) return cachedRoot;

  if (clientSupportsRoots) {
    const response = await sendRequest("roots/list");
    const uri = response?.result?.roots?.[0]?.uri;
    if (typeof uri === "string" && uri.trim()) {
      cachedRoot = resolveWorkspaceRoot({ workspace_roots: [uri] });
      return cachedRoot;
    }
  }

  return resolveWorkspaceRoot({});
}

async function store() {
  return new CoordinationStore(await workspaceRoot());
}

function textResult(payload, isError = false) {
  return {
    isError,
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }]
  };
}

async function callTool(name, args = {}) {
  if (name === "get_handoff") {
    const snapshot = (await store()).getHandoffSnapshot();
    return textResult({
      revision: snapshot.revision,
      content: snapshot.content || "(empty handoff)"
    });
  }

  if (name === "write_handoff") {
    const content = args.content;
    if (typeof content !== "string") {
      return textResult("content must be a string", true);
    }
    try {
      const next = await store();
      const written = next.writeHandoff(content, args.expected_revision);
      next.appendEvent("HANDOFF_WRITE", JSON.stringify({ chars: content.trim().length, revision: written.revision }));
      return textResult({ status: "updated", revision: written.revision });
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
    return rpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    });
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  if (method === "notifications/roots/list_changed") {
    cachedRoot = null;
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
    const result = await callTool(name, args);
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
