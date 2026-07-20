import { describe, expect, it, vi } from "vitest";
import type { Liveness } from "./liveness.js";
import type { PinsFile } from "./pins.js";
import { loadAllAndReconcile, parseStateFile } from "./reconcile.js";
import { SCHEMA_VERSION, type StateFile } from "./schema.js";

function makeFile(overrides: Partial<StateFile> = {}): StateFile {
  return {
    schema: SCHEMA_VERSION,
    sessionId: "s1",
    sessionFile: "/x/s1.jsonl",
    sessionName: "demo",
    state: "working",
    blockedLabel: null,
    cwd: "/home/u/proj",
    branch: "main",
    model: "anthropic/claude",
    pid: 4242,
    startTime: 111,
    bootId: null,
    nonce: "n1",
    updatedAt: 1000,
    terminal: { program: "iTerm.app" },
    ...overrides,
  };
}

describe("parseStateFile", () => {
  it("parses a valid file", () => {
    const f = parseStateFile(JSON.stringify(makeFile()));
    expect(f?.sessionId).toBe("s1");
    expect(f?.state).toBe("working");
    expect(f?.terminal.program).toBe("iTerm.app");
  });

  it("returns null on invalid JSON", () => {
    expect(parseStateFile("{not json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseStateFile(JSON.stringify({ schema: 1, pid: 1, cwd: "/x" }))).toBeNull(); // no sessionId
    expect(parseStateFile(JSON.stringify({ schema: 1, sessionId: "s", cwd: "/x" }))).toBeNull(); // no pid
  });

  it("skips files from a newer breaking schema", () => {
    expect(parseStateFile(JSON.stringify(makeFile({ schema: SCHEMA_VERSION + 1 })))).toBeNull();
  });

  it("normalizes unknown state to idle", () => {
    const f = parseStateFile(JSON.stringify(makeFile({ state: "wat" as never })));
    expect(f?.state).toBe("idle");
  });

  it("defaults a missing terminal to an empty object", () => {
    const raw = makeFile();
    // biome-ignore lint/performance/noDelete: test needs the key absent
    delete (raw as { terminal?: unknown }).terminal;
    const f = parseStateFile(JSON.stringify(raw));
    expect(f?.terminal).toEqual({});
  });
});

describe("loadAllAndReconcile", () => {
  const files: Record<string, StateFile> = {
    "alive.json": makeFile({ sessionId: "alive", pid: 1, state: "working", updatedAt: 5000 }),
    "dead.json": makeFile({ sessionId: "dead", pid: 2, state: "idle", updatedAt: 100 }),
  };

  const baseDeps = {
    now: () => 10_000,
    readdir: () => ["alive.json", "dead.json", ".hidden.json", ".alive.json.abc.tmp", "notes.txt"],
    readFile: (p: string) => {
      const name = p.split("/").pop() as string;
      if (!files[name]) throw new Error("ENOENT");
      return JSON.stringify(files[name]);
    },
    isAlive: (pid: number): Liveness => (pid === 1 ? "alive" : "gone"),
  };

  it("annotates liveness and derives dormant for dead processes", () => {
    const snaps = loadAllAndReconcile("/live", baseDeps);
    const byId = Object.fromEntries(snaps.map((s) => [s.file.sessionId, s]));
    expect(byId.alive.liveState).toBe("working");
    expect(byId.dead.liveState).toBe("dormant");
    expect(byId.alive.ageMs).toBe(5000);
  });

  it("skips dotfiles, temp files, and non-json entries", () => {
    const snaps = loadAllAndReconcile("/live", baseDeps);
    expect(snaps).toHaveLength(2);
    expect(snaps.map((s) => s.file.sessionId).sort()).toEqual(["alive", "dead"]);
  });

  it("never deletes on disk unless prune is explicitly requested (D4: read paths must not mutate)", () => {
    const unlink = vi.fn();
    // gcTtlMs alone (no `prune: true`) must not delete anything — this is what
    // --once/--json/live/focus pass (or omit); only `gc` sets prune:true.
    const snaps = loadAllAndReconcile("/live", { ...baseDeps, unlink, gcTtlMs: 1000 });
    expect(unlink).not.toHaveBeenCalled();
    expect(snaps.map((s) => s.file.sessionId).sort()).toEqual(["alive", "dead"]);
  });

  it("garbage-collects dead files older than the TTL when prune:true", () => {
    const unlink = vi.fn();
    const snaps = loadAllAndReconcile("/live", { ...baseDeps, unlink, gcTtlMs: 1000, prune: true });
    // dead.json age is 9900 > 1000 -> deleted; alive.json stays.
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith("/live/dead.json");
    expect(snaps.map((s) => s.file.sessionId)).toEqual(["alive"]);
  });

  it("does not GC live files even if old, even when prune:true", () => {
    const unlink = vi.fn();
    loadAllAndReconcile("/live", {
      ...baseDeps,
      isAlive: () => "alive",
      unlink,
      gcTtlMs: 1,
      prune: true,
    });
    expect(unlink).not.toHaveBeenCalled();
  });

  it("returns [] when the directory cannot be read", () => {
    expect(
      loadAllAndReconcile("/nope", {
        readdir: () => {
          throw new Error("ENOENT");
        },
      }),
    ).toEqual([]);
  });

  it("defaults to no pins (auto-loads via the injected readFile, which throws ENOENT here)", () => {
    const snaps = loadAllAndReconcile("/live", baseDeps);
    expect(snaps.every((s) => s.pinned === false)).toBe(true);
  });

  // AC3: presence-pins.json lives outside the live dir entirely (see paths.test.ts), so it's
  // never a readdir candidate in the first place; belt-and-suspenders, its shape ({version,
  // pins}) also fails parseStateFile's required fields, so even a stray copy inside the live
  // dir would be silently skipped, never surfaced as a bogus session.
  it("AC3: a presence-pins.json-shaped file (if ever scanned) is silently skipped, not parsed as a session", () => {
    const rawFiles: Record<string, string> = {
      "alive.json": JSON.stringify(files["alive.json"]),
      "dead.json": JSON.stringify(files["dead.json"]),
      "presence-pins.json": JSON.stringify({ version: 1, pins: [] }),
    };
    const snaps = loadAllAndReconcile("/live", {
      ...baseDeps,
      readdir: () => Object.keys(rawFiles),
      readFile: (p: string) => {
        const name = p.split("/").pop() as string;
        if (!(name in rawFiles)) throw new Error("ENOENT");
        return rawFiles[name] as string;
      },
    });
    expect(snaps.map((s) => s.file.sessionId).sort()).toEqual(["alive", "dead"]);
  });
});

describe("loadAllAndReconcile pin protection (gc)", () => {
  const files: Record<string, StateFile> = {
    "pinned.json": makeFile({ sessionId: "pinned", pid: 2, state: "idle", updatedAt: 100 }),
    "unpinned.json": makeFile({
      sessionId: "unpinned",
      sessionFile: "/x/other.jsonl",
      pid: 3,
      state: "idle",
      updatedAt: 100,
    }),
  };
  // Matches "pinned.json" by sessionFile (makeFile's default "/x/s1.jsonl").
  const pins: PinsFile = {
    version: 1,
    pins: [
      {
        sessionFile: "/x/s1.jsonl",
        sessionId: "pinned",
        cwd: "/home/u/proj",
        name: "demo",
        pinnedAt: 1,
      },
    ],
  };

  const baseDeps = {
    now: () => 10_000,
    readdir: () => ["pinned.json", "unpinned.json"],
    readFile: (p: string) => {
      const name = p.split("/").pop() as string;
      if (!files[name]) throw new Error("ENOENT");
      return JSON.stringify(files[name]);
    },
    isAlive: (): Liveness => "gone", // both dead -> both TTL-expired at gcTtlMs below
  };

  // AC4: a pinned session killed and TTL-expired survives gc (default TTL) with its file intact.
  it("AC4: gc (default TTL) never prunes a pinned session's file, even when TTL-expired", () => {
    const unlink = vi.fn();
    const snaps = loadAllAndReconcile("/live", {
      ...baseDeps,
      pins,
      unlink,
      gcTtlMs: 1000,
      prune: true,
    });
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith("/live/unpinned.json");
    expect(snaps.map((s) => s.file.sessionId)).toEqual(["pinned"]);
    expect(snaps[0]?.pinned).toBe(true);
  });

  // AC4: "gc --all" also never prunes it — index.ts maps --all to gcTtlMs=1.
  it("AC4: gc --all (gcTtlMs=1) still skips the pinned file", () => {
    const unlink = vi.fn();
    loadAllAndReconcile("/live", { ...baseDeps, pins, unlink, gcTtlMs: 1, prune: true });
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith("/live/unpinned.json");
  });

  // AC5: once unpinned, the next gc prunes it exactly as it would have pre-pinning.
  it("AC5: unpinning makes a TTL-expired dormant session prunable again", () => {
    const unlink = vi.fn();
    const emptyPins: PinsFile = { version: 1, pins: [] };
    loadAllAndReconcile("/live", {
      ...baseDeps,
      pins: emptyPins,
      unlink,
      gcTtlMs: 1000,
      prune: true,
    });
    expect(unlink).toHaveBeenCalledTimes(2);
    expect(unlink).toHaveBeenCalledWith("/live/pinned.json");
    expect(unlink).toHaveBeenCalledWith("/live/unpinned.json");
  });
});
