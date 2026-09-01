import { resolveWorkspaceRoot, sessionIdFrom } from "../lib/context.js";
import { CoordinationStore } from "../lib/store.js";
import { failOpen, readHookInput, writeHookOutput } from "../lib/io.js";

try {
  const input = await readHookInput();
  const status = typeof input.status === "string" ? input.status : "unknown";
  const store = new CoordinationStore(resolveWorkspaceRoot(input));
  store.appendEvent("SESSION_STOP", JSON.stringify({ status }), sessionIdFrom(input));
  // Never return followup_message — V0 forbids automatic loops from hooks.
  writeHookOutput({});
} catch (error) {
  failOpen(error);
}
