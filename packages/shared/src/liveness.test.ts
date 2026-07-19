import { describe, expect, it } from "vitest";
import { REUSE_TOLERANCE_MS, isAlive, readProcStartTime, readSelfStartTime } from "./liveness.js";

function killThrowing(code: string) {
  return () => {
    const err = new Error(code) as NodeJS.ErrnoException;
    err.code = code;
    throw err;
  };
}

describe("isAlive", () => {
  it("returns alive when kill(0) succeeds and no startTime given", () => {
    expect(isAlive(123, undefined, { kill: () => {} })).toBe("alive");
  });

  it("maps ESRCH to gone", () => {
    expect(isAlive(123, undefined, { kill: killThrowing("ESRCH") })).toBe("gone");
  });

  it("maps EPERM to alive (exists, not ours)", () => {
    expect(isAlive(123, undefined, { kill: killThrowing("EPERM") })).toBe("alive");
  });

  it("maps other errors to gone", () => {
    expect(isAlive(123, undefined, { kill: killThrowing("EINVAL") })).toBe("gone");
  });

  it("detects PID reuse via start-time mismatch", () => {
    const startTime = 1_000_000;
    expect(
      isAlive(123, startTime, {
        kill: () => {},
        readStartTime: () => startTime + REUSE_TOLERANCE_MS + 5000,
      }),
    ).toBe("reused");
  });

  it("treats start-time within tolerance as the same process", () => {
    const startTime = 1_000_000;
    expect(
      isAlive(123, startTime, {
        kill: () => {},
        readStartTime: () => startTime + REUSE_TOLERANCE_MS - 1,
      }),
    ).toBe("alive");
  });

  it("stays alive when start time is unreadable", () => {
    expect(isAlive(123, 1_000_000, { kill: () => {}, readStartTime: () => undefined })).toBe(
      "alive",
    );
  });
});

describe("start-time estimation", () => {
  it("reads this process's start time close to the self estimate", () => {
    const self = readSelfStartTime();
    const viaPs = readProcStartTime(process.pid);
    expect(self).toBeGreaterThan(0);
    // ps may be unavailable in some sandboxes; only assert when we got a value.
    if (viaPs !== undefined) {
      expect(Math.abs(viaPs - self)).toBeLessThan(REUSE_TOLERANCE_MS + 1500);
    }
  });

  it("returns undefined for an impossible pid", () => {
    expect(readProcStartTime(2 ** 30)).toBeUndefined();
  });
});
