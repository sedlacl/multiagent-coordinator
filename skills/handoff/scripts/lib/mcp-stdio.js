/**
 * MCP stdio: Content-Length framing with NDJSON fallback.
 */

export function encodeMessage(obj) {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]);
}

export function createFramedReader(onMessage) {
  let buf = Buffer.alloc(0);

  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);

    for (;;) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const header = buf.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          buf = buf.subarray(headerEnd + 4);
          continue;
        }
        const len = Number(match[1]);
        const start = headerEnd + 4;
        if (buf.length < start + len) return;
        const body = buf.subarray(start, start + len).toString("utf8");
        buf = buf.subarray(start + len);
        onMessage(JSON.parse(body));
        continue;
      }

      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const line = buf.subarray(0, nl).toString("utf8").trim();
      buf = buf.subarray(nl + 1);
      if (!line.startsWith("{")) continue;
      onMessage(JSON.parse(line));
    }
  };
}
