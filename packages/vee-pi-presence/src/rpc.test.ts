import { describe, expect, it } from "vitest";
import { createLineDecoder, encodeMessage } from "./rpc.js";

const LS = String.fromCharCode(0x2028); // Unicode LINE SEPARATOR

describe("encodeMessage", () => {
  it("serializes with a trailing newline", () => {
    expect(encodeMessage({ a: 1 })).toBe('{"a":1}\n');
  });
});

describe("createLineDecoder", () => {
  it("decodes complete frames", () => {
    const decode = createLineDecoder();
    const msgs = decode('{"jsonrpc":"2.0","method":"a"}\n{"jsonrpc":"2.0","method":"b"}\n');
    expect(msgs.map((m) => m.method)).toEqual(["a", "b"]);
  });

  it("buffers partial frames across chunks", () => {
    const decode = createLineDecoder();
    expect(decode('{"jsonrpc":"2.0",')).toEqual([]);
    const msgs = decode('"method":"x"}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe("x");
  });

  it("only splits on \\n, not other separators inside strings", () => {
    const decode = createLineDecoder();
    // A JSON string value containing a Unicode line separator (U+2028) must not split.
    const msgs = decode('{"jsonrpc":"2.0","method":"m","params":{"t":"a\\u2028b"}}\n');
    expect(msgs).toHaveLength(1);
    expect((msgs[0]?.params as { t: string }).t).toBe(`a${LS}b`);
  });

  it("tolerates \\r\\n and skips blank/malformed lines", () => {
    const decode = createLineDecoder();
    const msgs = decode(
      '{"jsonrpc":"2.0","method":"a"}\r\n\nnot json\n{"jsonrpc":"2.0","method":"b"}\n',
    );
    expect(msgs.map((m) => m.method)).toEqual(["a", "b"]);
  });
});
