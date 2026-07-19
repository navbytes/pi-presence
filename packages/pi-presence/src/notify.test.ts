import { describe, expect, it, vi } from "vitest";
import { buildNotifyScript, decideNotification, sendNotification } from "./notify.js";

describe("decideNotification", () => {
  const base = { thresholdMs: 10_000, sessionName: "nt" };

  it("notifies on entering blocked, with the label", () => {
    const n = decideNotification({
      ...base,
      from: "working",
      to: "blocked",
      workingMs: 0,
      blockedLabel: "Allow rm -rf?",
    });
    expect(n).toEqual({ kind: "blocked", title: "pi needs you", message: "nt: Allow rm -rf?" });
  });

  it("notifies on blocked without a label", () => {
    const n = decideNotification({ ...base, from: "idle", to: "blocked", workingMs: 0 });
    expect(n?.message).toBe("nt is waiting for you");
  });

  it("notifies finished only past the threshold", () => {
    expect(
      decideNotification({ ...base, from: "working", to: "idle", workingMs: 9_000 }),
    ).toBeNull();
    const n = decideNotification({ ...base, from: "working", to: "idle", workingMs: 12_000 });
    expect(n).toEqual({ kind: "finished", title: "pi finished", message: "nt is idle" });
  });

  it("does not notify on non-notable transitions", () => {
    expect(decideNotification({ ...base, from: "idle", to: "working", workingMs: 0 })).toBeNull();
    expect(decideNotification({ ...base, from: "blocked", to: "idle", workingMs: 0 })).toBeNull();
  });
});

describe("buildNotifyScript", () => {
  it("escapes quotes and backslashes", () => {
    const script = buildNotifyScript({
      kind: "blocked",
      title: 'say "hi"',
      message: "path C:\\x",
    });
    expect(script).toContain('with title "say \\"hi\\""');
    expect(script).toContain('display notification "path C:\\\\x"');
  });
});

describe("sendNotification", () => {
  const n = { kind: "finished" as const, title: "t", message: "m" };

  it("no-ops on non-darwin", () => {
    const run = vi.fn();
    expect(sendNotification(n, { run, platform: "linux" })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs osascript on darwin", () => {
    const run = vi.fn();
    expect(sendNotification(n, { run, platform: "darwin" })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("never throws if the runner fails", () => {
    const run = vi.fn(() => {
      throw new Error("boom");
    });
    expect(sendNotification(n, { run, platform: "darwin" })).toBe(false);
  });
});
