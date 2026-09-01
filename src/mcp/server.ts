import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { resolveWorkspaceRoot } from '../state/context.js';
import {
  CoordinationStore,
  HANDOFF_MAX_CHARS,
  HandoffConflictError
} from '../state/store.js';

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
        'Read the current compact coordination state and revision from handoff.md. Keep the revision and pass it to write_handoff to avoid overwriting another session.',
      inputSchema: z.object({})
    },
    async () => {
      const snapshot = store().getHandoffSnapshot();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                revision: snapshot.revision,
                content: snapshot.content || '(empty handoff)'
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    'write_handoff',
    {
      title: 'Write handoff',
      description:
        `Replace handoff.md with compact current state (max ${HANDOFF_MAX_CHARS} chars). Pass expected_revision from get_handoff; stale writes fail instead of overwriting another session.`,
      inputSchema: z.object({
        content: z
          .string()
          .max(HANDOFF_MAX_CHARS)
          .describe('Full replacement markdown for handoff.md'),
        expected_revision: z
          .string()
          .length(64)
          .optional()
          .describe('Revision returned by get_handoff. Omit only for an intentional unconditional write.')
      })
    },
    async ({ content, expected_revision }) => {
      try {
        const next = new CoordinationStore(resolveWorkspaceRoot({}));
        const written = next.writeHandoff(content, expected_revision);
        next.appendEvent(
          'HANDOFF_WRITE',
          JSON.stringify({ chars: content.trim().length, revision: written.revision })
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'updated', revision: written.revision })
            }
          ]
        };
      } catch (error) {
        if (error instanceof HandoffConflictError) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'conflict',
                  expected_revision: error.expectedRevision,
                  current_revision: error.currentRevision,
                  action: 'Call get_handoff, merge current state, then retry write_handoff with the new revision.'
                })
              }
            ]
          };
        }

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
