import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CoordinationEvent } from './types.js';

export const HANDOFF_MAX_CHARS = 8000;

function stateDir(workspaceRoot: string): string {
  const override = process.env.MAC_STATE_DIR?.trim();
  return override ? resolve(override) : join(workspaceRoot, '.cursor', 'multiagent-coordinator');
}

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export class CoordinationStore {
  private readonly dir: string;
  private readonly handoffPath: string;
  private readonly eventsPath: string;

  constructor(workspaceRoot: string) {
    this.dir = stateDir(workspaceRoot);
    this.handoffPath = join(this.dir, 'handoff.md');
    this.eventsPath = join(this.dir, 'events.jsonl');
    mkdirSync(join(this.dir, 'sessions'), { recursive: true });
  }

  getHandoff(): string {
    try {
      return readFileSync(this.handoffPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  writeHandoff(content: string): void {
    const body = content.trimEnd();
    if (body.length > HANDOFF_MAX_CHARS) {
      throw new Error(`handoff exceeds ${HANDOFF_MAX_CHARS} characters (${body.length})`);
    }
    mkdirSync(dirname(this.handoffPath), { recursive: true });
    writeFileSync(this.handoffPath, body + '\n', 'utf8');
  }

  appendEvent(kind: string, payload: string, sourceSession?: string | null): CoordinationEvent {
    const event: CoordinationEvent = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      sourceSession: sourceSession ?? null,
      kind,
      payload,
      createdAt: new Date().toISOString()
    };
    appendFileSync(this.eventsPath, JSON.stringify(event) + '\n', 'utf8');
    return event;
  }

  recentEvents(limit = 50): CoordinationEvent[] {
    let text = '';
    try {
      text = readFileSync(this.eventsPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as CoordinationEvent);
  }

  unseenEventsForSession(sessionId: string, limit = 50): CoordinationEvent[] {
    const cursorPath = join(this.dir, 'sessions', `${safeSessionId(sessionId)}.cursor`);
    let lastId = 0;
    try {
      lastId = Number(readFileSync(cursorPath, 'utf8').trim()) || 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return this.recentEvents(limit).filter((event) => event.id > lastId);
  }

  advanceSessionCursor(sessionId: string, eventId: number): void {
    const cursorPath = join(this.dir, 'sessions', `${safeSessionId(sessionId)}.cursor`);
    writeFileSync(cursorPath, String(eventId), 'utf8');
  }
}
