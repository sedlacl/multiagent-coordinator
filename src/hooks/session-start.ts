import { renderSnapshot, resolveScope, sessionIdFrom } from '../state/context.js';
import { CoordinationStore } from '../state/store.js';
import { failOpen, readHookInput, writeHookOutput } from './io.js';

try {
  const input = await readHookInput();
  const store = new CoordinationStore();
  const scope = resolveScope(input);
  const sessionId = sessionIdFrom(input);
  const state = store.getState(scope);
  const events = store.recentEvents(scope, 0, 20);
  if (sessionId && events.length) store.advanceSessionCursor(sessionId, scope, events.at(-1)!.id);
  store.close();

  const snapshot = renderSnapshot(state);
  writeHookOutput(state.version > 0 ? { additional_context: snapshot } : {});
} catch (error) {
  failOpen(error);
}
