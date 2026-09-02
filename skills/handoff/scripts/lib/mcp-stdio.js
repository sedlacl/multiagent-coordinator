/**
 * MCP stdio: newline-delimited JSON on the wire. The reader also accepts
 * LSP-style Content-Length frames, which some clients still send.
 */

export function encodeMessage(obj) {
  // JSON.stringify never emits a raw newline, so one line per message holds.
  return Buffer.from(`${JSON.stringify(obj)}\n`, "utf8");
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
