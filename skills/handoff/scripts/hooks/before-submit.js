import { createHash } from "node:crypto";
import { resolveWorkspaceRoot, sessionIdFrom } from "../lib/context.js";
import { CoordinationStore } from "../lib/store.js";
import { failOpen, readHookInput, writeHookOutput } from "../lib/io.js";

try {
  const input = await readHookInput();
  const prompt = input.prompt ?? input.user_prompt ?? input.message;
  if (typeof prompt === "string" && prompt.trim()) {
    const text = prompt.trim();
    const store = new CoordinationStore(resolveWorkspaceRoot(input));
    store.appendEvent(
      "USER_PROMPT",
      JSON.stringify({
        chars: text.length,
        sha256: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)
      }),
      sessionIdFrom(input)
    );
  }
  writeHookOutput({});
} catch (error) {
  failOpen(error);
}
