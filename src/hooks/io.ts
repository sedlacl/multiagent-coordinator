export async function readHookInput(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export function writeHookOutput(output: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function failOpen(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[multiagent-coordinator] ${message}\n`);
  writeHookOutput({});
}
