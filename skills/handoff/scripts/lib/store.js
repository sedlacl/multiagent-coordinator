import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const HANDOFF_MAX_CHARS = 8000;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;
const LOCK_RETRIES = 40;
const STATE_GITIGNORE = `# Local runtime state of the multiagent-coordinator plugin.
# Nothing in this directory belongs in version control.
*
`;

export class HandoffConflictError extends Error {
  constructor(expectedRevision, currentRevision) {
    super(`handoff revision conflict: expected ${expectedRevision}, current ${currentRevision}`);
    this.name = "HandoffConflictError";
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

function stateDir(workspaceRoot) {
  const override = process.env.MAC_STATE_DIR?.trim();
  return override ? resolve(override) : join(workspaceRoot, ".cursor", "multiagent-coordinator");
}

function ensureStateGitignore(dir) {
  try {
    writeFileSync(join(dir, ".gitignore"), STATE_GITIGNORE, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

function safeSessionId(sessionId) {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeHandoff(content) {
  return content.trimEnd();
}

function revisionFor(content) {
  return createHash("sha256").update(normalizeHandoff(content), "utf8").digest("hex");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class CoordinationStore {
  constructor(workspaceRoot) {
    this.dir = stateDir(workspaceRoot);
    this.handoffPath = join(this.dir, "handoff.md");
    this.lockPath = join(this.dir, "handoff.lock");
    this.eventsPath = join(this.dir, "events.jsonl");
    mkdirSync(join(this.dir, "sessions"), { recursive: true });
    ensureStateGitignore(this.dir);
  }

  getHandoff() {
    return this.getHandoffSnapshot().content;
  }

  getHandoffSnapshot() {
    let content = "";
    try {
      content = normalizeHandoff(readFileSync(this.handoffPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { content, revision: revisionFor(content) };
  }

  writeHandoff(content, expectedRevision) {
    const body = normalizeHandoff(content);
    if (body.length > HANDOFF_MAX_CHARS) {
      throw new Error(`handoff exceeds ${HANDOFF_MAX_CHARS} characters (${body.length})`);
    }

    return this.withWriteLock(() => {
      const current = this.getHandoffSnapshot();
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new HandoffConflictError(expectedRevision, current.revision);
      }

      mkdirSync(dirname(this.handoffPath), { recursive: true });
      const tempPath = join(this.dir, `.handoff.${process.pid}.${randomUUID()}.tmp`);
      try {
        writeFileSync(tempPath, body ? `${body}\n` : "", { encoding: "utf8", flag: "wx" });
        renameSync(tempPath, this.handoffPath);
      } catch (error) {
        try {
          unlinkSync(tempPath);
        } catch {
          // Best-effort cleanup only.
        }
        throw error;
      }

      return { content: body, revision: revisionFor(body) };
    });
  }

  withWriteLock(fn) {
    for (let attempt = 0; attempt <= LOCK_RETRIES; attempt += 1) {
      let fd;
      try {
        fd = openSync(this.lockPath, "wx");
        writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
        try {
          return fn();
        } finally {
          closeSync(fd);
          fd = undefined;
          try {
            unlinkSync(this.lockPath);
          } catch {
            // Best-effort cleanup only.
          }
        }
      } catch (error) {
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch {
            // Best-effort cleanup only.
          }
        }

        if (error.code !== "EEXIST") throw error;

        try {
          if (Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS) {
            unlinkSync(this.lockPath);
            continue;
          }
        } catch (staleError) {
          if (staleError.code === "ENOENT") continue;
        }

        if (attempt === LOCK_RETRIES) {
          throw new Error(`handoff write lock busy after ${(LOCK_RETRIES + 1) * LOCK_RETRY_MS}ms`);
        }
        sleepSync(LOCK_RETRY_MS);
      }
    }

    throw new Error("unreachable handoff lock state");
  }

  appendEvent(kind, payload, sourceSession) {
    const event = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      sourceSession: sourceSession ?? null,
      kind,
      payload,
      createdAt: new Date().toISOString()
    };
    appendFileSync(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  recentEvents(limit = 50) {
    let text = "";
    try {
      text = readFileSync(this.eventsPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }

    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line));
  }

  unseenEventsForSession(sessionId, limit = 50) {
    const cursorPath = join(this.dir, "sessions", `${safeSessionId(sessionId)}.cursor`);
    let lastId = 0;
    try {
      lastId = Number(readFileSync(cursorPath, "utf8").trim()) || 0;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this.recentEvents(limit).filter((event) => event.id > lastId);
  }

  advanceSessionCursor(sessionId, eventId) {
    const cursorPath = join(this.dir, "sessions", `${safeSessionId(sessionId)}.cursor`);
    writeFileSync(cursorPath, String(eventId), "utf8");
  }
}
