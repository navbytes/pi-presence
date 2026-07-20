import { describe, expect, it } from "vitest";
import {
  REUSE_TOLERANCE_MS,
  isAlive,
  parseBsdElapsedTime,
  readProcStartTime,
  readSelfStartTime,
} from "./liveness.js";

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

// D5: `ps -o etimes=` (GNU/procps) isn't supported by BSD `ps` on macOS
// ("etimes: keyword not found"), so readProcStartTime falls back to parsing
// `ps -o etime=`'s `[[dd-]hh:]mm:ss` format. This parser is pure and covers
// that fallback in isolation.
describe("parseBsdElapsedTime", () => {
  it("parses a bare seconds count", () => {
    expect(parseBsdElapsedTime("05")).toBe(5);
    expect(parseBsdElapsedTime("0")).toBe(0);
  });

  it("parses mm:ss", () => {
    expect(parseBsdElapsedTime("1:23")).toBe(83);
  });

  it("parses hh:mm:ss", () => {
    expect(parseBsdElapsedTime("12:34:56")).toBe(12 * 3600 + 34 * 60 + 56);
  });

  it("parses dd-hh:mm:ss", () => {
    expect(parseBsdElapsedTime("3-01:02:03")).toBe(3 * 86400 + 1 * 3600 + 2 * 60 + 3);
  });

  it("tolerates surrounding whitespace (ps right-aligns its column)", () => {
    expect(parseBsdElapsedTime("  1:23  ")).toBe(83);
  });

  it("returns undefined for garbage", () => {
    expect(parseBsdElapsedTime("")).toBeUndefined();
    expect(parseBsdElapsedTime("keyword not found")).toBeUndefined();
    expect(parseBsdElapsedTime("1:2:3:4")).toBeUndefined();
    expect(parseBsdElapsedTime("1:")).toBeUndefined();
    expect(parseBsdElapsedTime("-5")).toBeUndefined();
    expect(parseBsdElapsedTime("3-")).toBeUndefined();
    expect(parseBsdElapsedTime("3-5")).toBeUndefined(); // day prefix needs hh:mm:ss, not bare seconds
    expect(parseBsdElapsedTime("1:23.5")).toBeUndefined();
  });
});
