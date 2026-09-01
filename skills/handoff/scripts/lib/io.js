export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

export function writeHookOutput(output) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function failOpen(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[multiagent-coordinator] ${message}\n`);
  writeHookOutput({});
}
