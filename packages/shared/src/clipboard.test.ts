import { describe, expect, it, vi } from "vitest";
import { type ClipboardCommand, clipboardCandidates, copyToClipboard } from "./clipboard.js";

describe("clipboardCandidates", () => {
  it("picks pbcopy on macOS", () => {
    expect(clipboardCandidates("darwin")).toEqual([{ file: "pbcopy", args: [] }]);
  });
  it("picks clip on Windows", () => {
    expect(clipboardCandidates("win32")).toEqual([{ file: "clip", args: [] }]);
  });
  it("offers wl-copy, xclip, xsel on Linux", () => {
    expect(clipboardCandidates("linux").map((c) => c.file)).toEqual(["wl-copy", "xclip", "xsel"]);
  });
  it("returns nothing on unknown platforms", () => {
    expect(clipboardCandidates("aix")).toEqual([]);
  });
});

describe("copyToClipboard", () => {
  it("runs the first candidate and passes the text", () => {
    const run = vi.fn();
    expect(copyToClipboard("hello", { run, platform: "darwin" })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toEqual({ file: "pbcopy", args: [] });
    expect(run.mock.calls[0]?.[1]).toBe("hello");
  });

  it("falls through to the next candidate when one fails", () => {
    const run = vi.fn((cmd: ClipboardCommand) => {
      if (cmd.file === "wl-copy") throw new Error("not installed");
    });
    expect(copyToClipboard("x", { run, platform: "linux" })).toBe(true);
    expect(run.mock.calls.map((c) => (c[0] as ClipboardCommand).file)).toEqual([
      "wl-copy",
      "xclip",
    ]);
  });

  it("returns false when every candidate fails", () => {
    const run = vi.fn(() => {
      throw new Error("nope");
    });
    expect(copyToClipboard("x", { run, platform: "linux" })).toBe(false);
  });

  it("returns false on an unsupported platform", () => {
    const run = vi.fn();
    expect(copyToClipboard("x", { run, platform: "aix" })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
