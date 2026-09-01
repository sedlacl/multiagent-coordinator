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

function store() {
  return new CoordinationStore(resolveWorkspaceRoot({}));
}

function textResult(payload, isError = false) {
  return {
    isError,
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }]
  };
}

async function callTool(name, args = {}) {
  if (name === "get_handoff") {
    const snapshot = store().getHandoffSnapshot();
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
      const next = new CoordinationStore(resolveWorkspaceRoot({}));
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
    return rpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    });
  }

  if (method === "notifications/initialized" || method === "initialized") {
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
