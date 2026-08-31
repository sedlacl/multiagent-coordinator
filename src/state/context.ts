import { resolve } from 'node:path';
import type { CoordinationEvent, StoredState } from './types.js';

export function resolveScope(input: Record<string, unknown>): string {
  const explicit = process.env.MAC_SCOPE?.trim();
  if (explicit) return explicit;

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

function trim(text: string, max = 1800): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated]`;
}

export function renderSnapshot(stored: StoredState, maxChars = 5000): string {
  const state = stored.state;
  const sections: string[] = [
    `[MULTIAGENT COORDINATION SNAPSHOT v${stored.version}]`,
    state.summary ? `Summary:\n${state.summary}` : '',
    state.directives?.length ? `Directives:\n- ${state.directives.join('\n- ')}` : '',
    state.decisions?.length ? `Decisions:\n- ${state.decisions.join('\n- ')}` : '',
    state.activeWork?.length ? `Active work:\n- ${state.activeWork.join('\n- ')}` : '',
    state.queuedWork?.length ? `Queued work:\n- ${state.queuedWork.join('\n- ')}` : '',
    state.blockers?.length ? `Blockers:\n- ${state.blockers.join('\n- ')}` : '',
    state.notes?.length ? `Notes:\n- ${state.notes.join('\n- ')}` : ''
  ].filter(Boolean);

  return trim(sections.join('\n\n'), maxChars);
}

export function renderEventDelta(events: CoordinationEvent[], currentSession: string | null, maxChars = 3500): string {
  const external = events.filter((event) => !currentSession || event.sourceSession !== currentSession);
  if (external.length === 0) return '';

  const body = external.map((event) => `- [${event.kind}] ${trim(event.payload, 900)}`).join('\n');
  return trim(`[MULTIAGENT COORDINATION DELTA]\n${body}`, maxChars);
}
