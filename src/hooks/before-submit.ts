import { resolveScope, sessionIdFrom } from '../state/context.js';
import { CoordinationStore } from '../state/store.js';
import { failOpen, readHookInput, writeHookOutput } from './io.js';

try {
  const input = await readHookInput();
  const prompt = input.prompt ?? input.user_prompt ?? input.message;
  if (typeof prompt === 'string' && prompt.trim()) {
    const store = new CoordinationStore();
    store.appendEvent(resolveScope(input), 'USER_DIRECTIVE', prompt.trim().slice(0, 4000), sessionIdFrom(input));
    store.close();
  }
  writeHookOutput({});
} catch (error) {
  failOpen(error);
}
