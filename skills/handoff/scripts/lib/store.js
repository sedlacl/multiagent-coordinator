import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const HANDOFF_MAX_CHARS = 8000;
export const HANDOFF_NAME_MAX_CHARS = 80;
const HANDOFF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
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

export function normalizeHandoffName(name) {
  if (typeof name !== "string") throw new Error("handoff name must be a string");
  const normalized = name.trim();
  if (!HANDOFF_NAME_RE.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error(
      `invalid handoff name: use 1-${HANDOFF_NAME_MAX_CHARS} characters [A-Za-z0-9._-], starting with a letter or digit`
    );
  }
  return normalized;
}

function stateDir(workspaceRoot) {
  const override = process.env.MAC_STATE_DIR?.trim();
  return override ? resolve(override) : join(workspaceRoot, ".cursor", "multiagent-coordinator");
}

function globalStateDir() {
  const override = process.env.MAC_GLOBAL_STATE_DIR?.trim();
  return override ? resolve(override) : join(homedir(), ".multiagent-coordinator");
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

function readSnapshot(path) {
  let content = "";
  try {
    content = normalizeHandoff(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { content, revision: revisionFor(content) };
}

function withWriteLock(lockPath, fn) {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt <= LOCK_RETRIES; attempt += 1) {
    let fd;
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      try {
        return fn();
      } finally {
        closeSync(fd);
        fd = undefined;
        try {
          unlinkSync(lockPath);
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
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
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

function writeSnapshot(path, lockPath, content, expectedRevision) {
  const body = normalizeHandoff(content);
  if (body.length > HANDOFF_MAX_CHARS) {
    throw new Error(`handoff exceeds ${HANDOFF_MAX_CHARS} characters (${body.length})`);
  }

  return withWriteLock(lockPath, () => {
    const current = readSnapshot(path);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new HandoffConflictError(expectedRevision, current.revision);
    }

    mkdirSync(dirname(path), { recursive: true });
    const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      writeFileSync(tempPath, body ? `${body}\n` : "", { encoding: "utf8", flag: "wx" });
      renameSync(tempPath, path);
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

class NamedHandoffStore {
  constructor(dir) {
    this.dir = dir;
    this.handoffsDir = join(dir, "handoffs");
    this.locksDir = join(dir, "locks");
    mkdirSync(this.handoffsDir, { recursive: true });
  }

  handoffPath(name) {
    return join(this.handoffsDir, `${normalizeHandoffName(name)}.md`);
  }

  lockPath(name) {
    return join(this.locksDir, `${normalizeHandoffName(name)}.lock`);
  }

  listHandoffs() {
    try {
      return readdirSync(this.handoffsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name.slice(0, -3))
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  getHandoffSnapshot(name) {
    return readSnapshot(this.handoffPath(name));
  }

  writeHandoff(name, content, expectedRevision) {
    return writeSnapshot(this.handoffPath(name), this.lockPath(name), content, expectedRevision);
  }
}

export class CoordinationStore {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.dir = stateDir(workspaceRoot);
    this.handoffPath = join(this.dir, "handoff.md");
    this.lockPath = join(this.dir, "handoff.lock");
    this.eventsPath = join(this.dir, "events.jsonl");
    mkdirSync(join(this.dir, "sessions"), { recursive: true });
    ensureStateGitignore(this.dir);
    this.named = new NamedHandoffStore(this.dir);
  }

  listNamedHandoffs() {
    return this.named.listHandoffs();
  }

  namedHandoffPath(name) {
    return this.named.handoffPath(name);
  }

  getNamedHandoffSnapshot(name) {
    return this.named.getHandoffSnapshot(name);
  }

  writeNamedHandoff(name, content, expectedRevision) {
    return this.named.writeHandoff(name, content, expectedRevision);
  }

  // Legacy single-handoff API retained for the optional hook experiments.
  getHandoff() {
    return this.getHandoffSnapshot().content;
  }

  getHandoffSnapshot() {
    return readSnapshot(this.handoffPath);
  }

  writeHandoff(content, expectedRevision) {
    return writeSnapshot(this.handoffPath, this.lockPath, content, expectedRevision);
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

export class GlobalHandoffStore {
  constructor() {
    this.dir = globalStateDir();
    this.named = new NamedHandoffStore(this.dir);
  }

  listHandoffs() {
    return this.named.listHandoffs();
  }

  handoffPath(name) {
    return this.named.handoffPath(name);
  }

  getHandoffSnapshot(name) {
    return this.named.getHandoffSnapshot(name);
  }

  writeHandoff(name, content, expectedRevision) {
    return this.named.writeHandoff(name, content, expectedRevision);
  }
}
