import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "./reconcile.js";
import { type LiveState, SCHEMA_VERSION, type StateFile } from "./schema.js";
import { buildViewModel, groupForState } from "./view-model.js";

function snap(
  id: string,
  liveState: LiveState,
  updatedAt: number,
  overrides: Partial<StateFile> = {},
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
  };
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
