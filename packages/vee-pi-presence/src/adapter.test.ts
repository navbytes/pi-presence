import { type SessionSnapshot, buildViewModel } from "@pi-presence/shared";
import { type LiveState, SCHEMA_VERSION, type StateFile } from "@pi-presence/shared";
import { describe, expect, it } from "vitest";
import { ViewPublisher, projectForClient } from "./adapter.js";

function snap(id: string, liveState: LiveState, updatedAt: number): SessionSnapshot {
  const file: StateFile = {
    schema: SCHEMA_VERSION,
    sessionId: id,
    sessionFile: null,
    sessionName: id,
    state: liveState === "dormant" ? "idle" : liveState,
    blockedLabel: null,
    cwd: `/home/u/${id}`,
    branch: null,
    model: null,
    pid: 1,
    startTime: 0,
    bootId: null,
    nonce: "",
    updatedAt,
    terminal: {},
  };
  return {
    path: `/live/${id}.json`,
    file,
    liveness: liveState === "dormant" ? "gone" : "alive",
    liveState,
    ageMs: 0,
  };
}

describe("projectForClient", () => {
  it("drops generatedAt and per-session ageMs", () => {
    const vm = buildViewModel([snap("a", "working", 1)], 999);
    const view = projectForClient(vm);
    expect(view).not.toHaveProperty("generatedAt");
    expect(view.sessions[0]).not.toHaveProperty("ageMs");
    expect(view.counts.running).toBe(1);
  });
});

describe("ViewPublisher", () => {
  it("emits a full replace first", () => {
    const p = new ViewPublisher();
    const msgs = p.next(buildViewModel([snap("a", "working", 1)]));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe("presence/replace");
  });

  it("emits a patch on the next changed model", () => {
    const p = new ViewPublisher();
    p.next(buildViewModel([snap("a", "working", 1)]));
    const msgs = p.next(buildViewModel([snap("a", "idle", 2)]));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe("presence/patch");
    expect(Array.isArray(msgs[0]?.params)).toBe(true);
  });

  it("emits nothing when only volatile fields (generatedAt/ageMs) changed", () => {
    const p = new ViewPublisher();
    const snaps = [snap("a", "working", 1)];
    p.next(buildViewModel(snaps, 1000));
    // Same underlying state, different generatedAt and recomputed ageMs.
    const later = buildViewModel(
      snaps.map((s) => ({ ...s, ageMs: s.ageMs + 5000 })),
      99999,
    );
    expect(p.next(later)).toEqual([]);
  });

  it("resets to a full replace", () => {
    const p = new ViewPublisher();
    p.next(buildViewModel([snap("a", "working", 1)]));
    p.reset();
    const msgs = p.next(buildViewModel([snap("a", "working", 1)]));
    expect(msgs[0]?.method).toBe("presence/replace");
  });
});
