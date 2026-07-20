import { describe, expect, it } from "vitest";
import { PINS_VERSION, type PinEntry, type PinsFile } from "./pins.js";
import type { SessionSnapshot } from "./reconcile.js";
import { type LiveState, SCHEMA_VERSION, type StateFile } from "./schema.js";
import { buildViewModel, groupForState } from "./view-model.js";

function snap(
  id: string,
  liveState: LiveState,
  updatedAt: number,
  overrides: Partial<StateFile> = {},
  pinned = false,
): SessionSnapshot {
  const file: StateFile = {
    schema: SCHEMA_VERSION,
    sessionId: id,
    sessionFile: null,
    sessionName: null,
    state: liveState === "dormant" ? "idle" : liveState,
    blockedLabel: liveState === "blocked" ? "Allow rm -rf?" : null,
    cwd: `/home/u/${id}`,
    branch: "main",
    model: null,
    pid: 1,
    startTime: 0,
    bootId: null,
    nonce: "",
    updatedAt,
    terminal: {},
    ...overrides,
  };
  return {
    path: `/live/${id}.json`,
    file,
    liveness: liveState === "dormant" ? "gone" : "alive",
    liveState,
    ageMs: 0,
    pinned,
  };
}

function pinEntry(overrides: Partial<PinEntry> = {}): PinEntry {
  return {
    sessionFile: null,
    sessionId: "x",
    cwd: "/home/u/x",
    name: "x",
    pinnedAt: 1,
    ...overrides,
  };
}

function pinsFile(pins: PinEntry[]): PinsFile {
  return { version: PINS_VERSION, pins };
}

describe("groupForState", () => {
  it("maps states to groups", () => {
    expect(groupForState("blocked")).toBe("needs-you");
    expect(groupForState("working")).toBe("running");
    expect(groupForState("idle")).toBe("idle");
    expect(groupForState("dormant")).toBe("dormant");
  });
});

describe("buildViewModel", () => {
  it("orders by group priority then recency", () => {
    const vm = buildViewModel([
      snap("idle-old", "idle", 10),
      snap("run-new", "working", 100),
      snap("run-old", "working", 50),
      snap("blocked", "blocked", 5),
      snap("dormant", "dormant", 999),
    ]);
    expect(vm.sessions.map((s) => s.id)).toEqual([
      "blocked", // needs-you
      "run-new", // running, newer first
      "run-old",
      "idle-old", // idle
      "dormant", // dormant last despite newest updatedAt
    ]);
  });

  it("counts groups", () => {
    const vm = buildViewModel([
      snap("a", "blocked", 1),
      snap("b", "working", 1),
      snap("c", "working", 1),
      snap("d", "idle", 1),
      snap("e", "dormant", 1),
    ]);
    expect(vm.counts).toEqual({ needsYou: 1, running: 2, idle: 1, dormant: 1, total: 5 });
  });

  it("surfaces the blocked label only for blocked sessions", () => {
    const vm = buildViewModel([snap("a", "blocked", 1), snap("b", "working", 1)]);
    const a = vm.sessions.find((s) => s.id === "a");
    const b = vm.sessions.find((s) => s.id === "b");
    expect(a?.blockedLabel).toBe("Allow rm -rf?");
    expect(b?.blockedLabel).toBeNull();
  });

  it("derives the display name from sessionName, then cwd basename, then id", () => {
    const withName = buildViewModel([snap("x", "idle", 1, { sessionName: "  My Task " })]);
    expect(withName.sessions[0]?.name).toBe("My Task");

    const withCwd = buildViewModel([snap("x", "idle", 1, { sessionName: null, cwd: "/a/b/repo" })]);
    expect(withCwd.sessions[0]?.name).toBe("repo");

    const bare = buildViewModel([snap("theid", "idle", 1, { sessionName: null, cwd: "" })]);
    expect(bare.sessions[0]?.name).toBe("theid");
  });
});

describe("buildViewModel pinning", () => {
  it("defaults to no pins and pinned:false when the pins arg is omitted", () => {
    const vm = buildViewModel([snap("a", "idle", 1)]);
    expect(vm.pinned).toEqual([]);
    expect(vm.sessions[0]?.pinned).toBe(false);
  });

  // AC10: TUI marks pinned sessions without altering existing grouping/sort order.
  it("AC10: carries the snapshot's pinned flag without changing group/sort order", () => {
    const vm = buildViewModel(
      [snap("a", "idle", 10, {}, true), snap("b", "idle", 20)],
      100,
      pinsFile([pinEntry({ sessionId: "a" })]),
    );
    expect(vm.sessions.map((s) => s.id)).toEqual(["b", "a"]); // recency order unchanged
    expect(vm.sessions.find((s) => s.id === "a")?.pinned).toBe(true);
    expect(vm.sessions.find((s) => s.id === "b")?.pinned).toBe(false);
  });

  // AC1/AC3: the pinned section is separate data, newest-pinned-first, distinct from `sessions`.
  it("AC1: builds a pinned-section row per pin, newest-pinned-first", () => {
    const vm = buildViewModel(
      [snap("a", "idle", 1), snap("b", "working", 1)],
      100,
      pinsFile([
        pinEntry({ sessionId: "a", pinnedAt: 5 }),
        pinEntry({ sessionId: "b", pinnedAt: 10 }),
      ]),
    );
    expect(vm.pinned.map((r) => r.sessionId)).toEqual(["b", "a"]);
    expect(vm.pinned.find((r) => r.sessionId === "a")?.session?.id).toBe("a");
  });

  // AC7: a pin with no matching snapshot degrades to a ghost row, never a crash.
  it("AC7: a pin with no matching live session renders as a ghost row from its cached fields", () => {
    const vm = buildViewModel(
      [snap("a", "idle", 1)],
      100,
      pinsFile([pinEntry({ sessionId: "gone", name: "old-task", cwd: "/home/u/gone" })]),
    );
    expect(vm.pinned).toHaveLength(1);
    expect(vm.pinned[0]?.session).toBeNull();
    expect(vm.pinned[0]).toMatchObject({ name: "old-task", cwd: "/home/u/gone" });
  });

  // AC6: a pin matches its session by sessionFile through a dormant->live transition, one row, no duplicate.
  it("AC6: matches a dormant pinned session by sessionFile, one row, no duplicate", () => {
    const vm = buildViewModel(
      [snap("a", "dormant", 1, { sessionFile: "/x/a.jsonl" })],
      100,
      pinsFile([pinEntry({ sessionId: "a", sessionFile: "/x/a.jsonl" })]),
    );
    expect(vm.sessions).toHaveLength(1);
    expect(vm.pinned).toHaveLength(1);
    expect(vm.pinned[0]?.session?.state).toBe("dormant");
  });

  it("matches by sessionFile over a stale cached sessionId (pi reusing the file on resume)", () => {
    const vm = buildViewModel(
      [snap("new-id", "idle", 1, { sessionFile: "/x/a.jsonl" })],
      100,
      pinsFile([pinEntry({ sessionId: "old-id", sessionFile: "/x/a.jsonl" })]),
    );
    expect(vm.pinned[0]?.session?.id).toBe("new-id");
  });

  it("prefers the live session's current name/cwd over the pin's cached copy", () => {
    const vm = buildViewModel(
      [snap("a", "idle", 1, { sessionName: "renamed", cwd: "/new/cwd" })],
      100,
      pinsFile([pinEntry({ sessionId: "a", name: "old-name", cwd: "/old/cwd" })]),
    );
    expect(vm.pinned[0]).toMatchObject({ name: "renamed", cwd: "/new/cwd" });
  });
});
