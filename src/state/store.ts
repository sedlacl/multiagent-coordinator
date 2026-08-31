import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CoordinationEvent, CoordinationState, StoredState } from './types.js';

function defaultDbPath(): string {
  return resolve(homedir(), '.multiagent-coordinator', 'state.db');
}

export class CoordinationStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = process.env.MAC_DB_PATH ?? defaultDbPath()) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS states (
        scope TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        source_session TEXT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_scope_id ON events(scope, id);
      CREATE TABLE IF NOT EXISTS session_cursors (
        session_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        last_event_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(session_id, scope)
      );
    `);
  }

  getState(scope: string): StoredState {
    const row = this.db.prepare('SELECT scope, version, json, updated_at FROM states WHERE scope = ?').get(scope) as
      | { scope: string; version: number; json: string; updated_at: string }
      | undefined;

    if (!row) {
      return { scope, version: 0, state: {}, updatedAt: new Date(0).toISOString() };
    }

    return {
      scope: row.scope,
      version: row.version,
      state: JSON.parse(row.json) as CoordinationState,
      updatedAt: row.updated_at
    };
  }

  writeState(scope: string, state: CoordinationState, expectedVersion?: number): StoredState {
    const current = this.getState(scope);
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new Error(`Version conflict: expected ${expectedVersion}, current ${current.version}`);
    }

    const nextVersion = current.version + 1;
    const updatedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO states(scope, version, json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        version = excluded.version,
        json = excluded.json,
        updated_at = excluded.updated_at
    `).run(scope, nextVersion, JSON.stringify(state), updatedAt);

    return { scope, version: nextVersion, state, updatedAt };
  }

  appendEvent(scope: string, kind: string, payload: string, sourceSession?: string | null): CoordinationEvent {
    const createdAt = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO events(scope, source_session, kind, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(scope, sourceSession ?? null, kind, payload, createdAt);

    return {
      id: Number(result.lastInsertRowid),
      scope,
      sourceSession: sourceSession ?? null,
      kind,
      payload,
      createdAt
    };
  }

  recentEvents(scope: string, afterId = 0, limit = 20): CoordinationEvent[] {
    const rows = this.db.prepare(`
      SELECT id, scope, source_session, kind, payload, created_at
      FROM events
      WHERE scope = ? AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `).all(scope, afterId, limit) as Array<{
      id: number;
      scope: string;
      source_session: string | null;
      kind: string;
      payload: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      sourceSession: row.source_session,
      kind: row.kind,
      payload: row.payload,
      createdAt: row.created_at
    }));
  }

  unseenEventsForSession(sessionId: string, scope: string, limit = 20): CoordinationEvent[] {
    const cursor = this.db.prepare(
      'SELECT last_event_id FROM session_cursors WHERE session_id = ? AND scope = ?'
    ).get(sessionId, scope) as { last_event_id: number } | undefined;
    return this.recentEvents(scope, cursor?.last_event_id ?? 0, limit);
  }

  advanceSessionCursor(sessionId: string, scope: string, eventId: number): void {
    this.db.prepare(`
      INSERT INTO session_cursors(session_id, scope, last_event_id)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, scope) DO UPDATE SET
        last_event_id = MAX(last_event_id, excluded.last_event_id)
    `).run(sessionId, scope, eventId);
  }

  close(): void {
    this.db.close();
  }
}
