// ---------------------------------------------------------------------------
// Newline-delimited JSON-RPC framing over stdio.
//
// Frames are split ONLY on "\n" (never on other Unicode line/paragraph
// separators), mirroring pi's own RPC caveat that generic line readers can
// wrongly split inside JSON string values. All non-protocol output MUST go to
// stderr; stdout carries frames exclusively.
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
}

/** Serialize a message as one newline-terminated frame. */
export function encodeMessage(msg: object): string {
  return `${JSON.stringify(msg)}\n`;
}

/**
 * Create a stateful decoder that accepts arbitrary stdin chunks and returns
 * whatever complete JSON frames have arrived. Partial trailing data is buffered;
 * malformed lines are skipped (not thrown).
 */
export function createLineDecoder(): (chunk: string) => JsonRpcRequest[] {
  let buffer = "";
  return (chunk: string): JsonRpcRequest[] => {
    buffer += chunk;
    const out: JsonRpcRequest[] = [];
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim(); // trim also drops a trailing \r
      buffer = buffer.slice(nl + 1);
      if (line.length > 0) {
        try {
          out.push(JSON.parse(line) as JsonRpcRequest);
        } catch {
          // ignore malformed frame
        }
      }
      nl = buffer.indexOf("\n");
    }
    return out;
  };
}
