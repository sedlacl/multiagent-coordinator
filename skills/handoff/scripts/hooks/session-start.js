import { renderHandoff, resolveWorkspaceRoot, sessionIdFrom } from "../lib/context.js";
import { CoordinationStore } from "../lib/store.js";
import { failOpen, readHookInput, writeHookOutput } from "../lib/io.js";

try {
  const input = await readHookInput();
  const workspaceRoot = resolveWorkspaceRoot(input);
  const store = new CoordinationStore(workspaceRoot);
  const sessionId = sessionIdFrom(input);
  const handoff = store.getHandoff();
  const events = store.recentEvents(20);
  if (sessionId && events.length) store.advanceSessionCursor(sessionId, events.at(-1).id);

  const context = renderHandoff(handoff);
  writeHookOutput(context ? { additional_context: context } : {});
} catch (error) {
  failOpen(error);
}
