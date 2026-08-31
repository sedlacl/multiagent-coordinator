import { resolve } from 'node:path';
import type { CoordinationEvent } from './types.js';

export function resolveWorkspaceRoot(input: Record<string, unknown>): string {
  const explicit = process.env.MAC_SCOPE?.trim();
  if (explicit) return resolve(explicit);

  const roots = input.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === 'string') return resolve(roots[0]);

  const cwd = input.cwd;
  if (typeof cwd === 'string' && cwd.trim()) return resolve(cwd);

  return resolve(process.cwd());
}

export function sessionIdFrom(input: Record<string, unknown>): string | null {
  const id = input.session_id ?? input.conversation_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function trim(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated]`;
}

export function renderHandoff(handoff: string, maxChars = 6000): string {
  if (!handoff.trim()) return '';
  return trim(`[MULTIAGENT HANDOFF]\n${handoff.trim()}`, maxChars);
}

export function renderEventDelta(events: CoordinationEvent[], currentSession: string | null, maxChars = 3500): string {
  const external = events.filter((event) => !currentSession || event.sourceSession !== currentSession);
  if (external.length === 0) return '';

  const body = external.map((event) => `- [${event.kind}] ${trim(event.payload, 900)}`).join('\n');
  return trim(`[MULTIAGENT COORDINATION DELTA]\n${body}`, maxChars);
}
