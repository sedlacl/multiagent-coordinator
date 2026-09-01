import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { resolveWorkspaceRoot } from '../state/context.js';
import { CoordinationStore, HANDOFF_MAX_CHARS } from '../state/store.js';

function store(): CoordinationStore {
  return new CoordinationStore(resolveWorkspaceRoot({}));
}

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'multiagent-coordinator', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_handoff',
    {
      title: 'Get handoff',
      description:
        'Read the current compact coordination state from handoff.md. Prefer this over reconstructing state from chat.',
      inputSchema: z.object({})
    },
    async () => {
      const text = store().getHandoff();
      return {
        content: [{ type: 'text' as const, text: text.trim() ? text : '(empty handoff)\n' }]
      };
    }
  );

  server.registerTool(
    'write_handoff',
    {
      title: 'Write handoff',
      description:
        `Replace handoff.md with compact current state (max ${HANDOFF_MAX_CHARS} chars). Overwrites; do not append. Include Goal, Confirmed facts, Decisions, Active work, Blockers, Verification, Next actions.`,
      inputSchema: z.object({
        content: z
          .string()
          .max(HANDOFF_MAX_CHARS)
          .describe('Full replacement markdown for handoff.md')
      })
    },
    async ({ content }) => {
      try {
        const next = new CoordinationStore(resolveWorkspaceRoot({}));
        next.writeHandoff(content);
        next.appendEvent('HANDOFF_WRITE', JSON.stringify({ chars: content.trim().length }));
        return { content: [{ type: 'text' as const, text: 'handoff updated' }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }]
        };
      }
    }
  );

  return server;
}

serveStdio(() => createServer(), {
  onerror: (error) => {
    process.stderr.write(`[multiagent-coordinator] ${error.stack ?? error.message}\n`);
  }
});
