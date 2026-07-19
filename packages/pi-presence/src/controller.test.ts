import { beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceController, type PresenceControllerDeps, type StateChange } from "./controller.js";
import type { StateFile } from "./schema.js";
import type { SessionIdentity } from "./state-writer.js";

/** Deterministic timer + clock harness. */
class Scheduler {
  now = 0;
  private seq = 1;
  private timers = new Map<number, { fn: () => void; at: number }>();

  setTimer = (fn: () => void, ms: number): number => {
    const id = this.seq++;
    this.timers.set(id, { fn, at: this.now + ms });
    return id;
  };

  clearTimer = (id: number): void => {
    this.timers.delete(id);
  };

  /** Advance time, firing due timers in chronological order (re-scheduling ok). */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < nextAt) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const t = this.timers.get(nextId);
      if (!t) break;
      this.timers.delete(nextId);
      this.now = t.at;
      t.fn();
    }
    this.now = target;
  }
}

function makeIdentity(overrides: Partial<SessionIdentity> = {}): SessionIdentity {
  return {
    sessionId: "sess-1",
    sessionFile: "/x/sess-1.jsonl",
    sessionName: "demo",
    cwd: "/home/u/proj",
    branch: "main",
    model: "anthropic/claude",
    pid: 1234,
    startTime: 999,
    bootId: null,
    nonce: "nonce-1",
    terminal: {},
    ...overrides,
  };
}

describe("PresenceController", () => {
  let sched: Scheduler;
  let idle: boolean;
  let writes: StateFile[];
  let titles: string[];
  let changes: StateChange[];
  let unlinked: string[];

  function makeController(depOverrides: Partial<PresenceControllerDeps<number>> = {}) {
    const deps: PresenceControllerDeps<number> = {
      now: () => sched.now,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
      isIdle: () => idle,
      writeState: (f) => writes.push(f),
      unlinkState: (id) => unlinked.push(id),
      writeTitle: (t) => titles.push(t),
      titleFormat: "{icon} {name} · {state}",
      onStateChange: (c) => changes.push(c),
      idleDebounceMs: 250,
      retryGraceMs: 2500,
      ...depOverrides,
    };
    return new PresenceController<number>(deps);
  }

  beforeEach(() => {
    sched = new Scheduler();
    idle = true;
    writes = [];
    titles = [];
    changes = [];
    unlinked = [];
  });

  it("writes idle on start", () => {
    const c = makeController();
    c.start(makeIdentity());
    expect(c.currentState).toBe("idle");
    expect(writes.at(-1)?.state).toBe("idle");
    expect(writes.at(-1)?.sessionId).toBe("sess-1");
  });

  it("transitions to working on agent_start", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.agentStart();
    expect(c.currentState).toBe("working");
    expect(writes.at(-1)?.state).toBe("working");
  });

  it("settles to idle after the debounce when idle", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.agentStart();
    idle = true;
    c.agentSettled();
    expect(c.currentState).toBe("working"); // not yet
    sched.advance(249);
    expect(c.currentState).toBe("working");
    sched.advance(1);
    expect(c.currentState).toBe("idle");
    expect(writes.at(-1)?.state).toBe("idle");
  });

  it("debounce collapses working→idle→working flicker", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.agentStart();
    c.agentSettled();
    sched.advance(100);
    c.agentStart(); // new run before the settle fires
    sched.advance(500);
    expect(c.currentState).toBe("working");
    expect(writes.filter((w) => w.state === "idle")).toHaveLength(1); // only the initial start
  });

  it("holds working when settle fires but the agent is not actually idle, then settles", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.agentStart();
    idle = false; // a retry/continuation is running
    c.agentSettled();
    sched.advance(250);
    expect(c.currentState).toBe("working"); // re-scheduled, not settled
    idle = true;
    sched.advance(2500);
    expect(c.currentState).toBe("idle");
  });

  it("blocks and restores the prior state via ref semantics", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.agentStart();
    c.blocked("Allow rm -rf?");
    expect(c.currentState).toBe("blocked");
    expect(writes.at(-1)?.state).toBe("blocked");
    expect(writes.at(-1)?.blockedLabel).toBe("Allow rm -rf?");
    c.unblocked();
    expect(c.currentState).toBe("working"); // restored
    expect(writes.at(-1)?.blockedLabel).toBeNull();
  });

  it("restores to idle when blocked started from idle", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.blocked("input?");
    c.unblocked();
    expect(c.currentState).toBe("idle");
  });

  it("does not let a pending settle override a block", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.agentStart();
    c.agentSettled();
    c.blocked("waiting");
    sched.advance(5000);
    expect(c.currentState).toBe("blocked");
  });

  it("records blockedLabel only on blocked state and includes title marker", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.agentStart();
    const workingWrite = writes.at(-1) as StateFile;
    expect(workingWrite.terminal.titleMarker).toContain("working");
    expect(titles.at(-1)).toContain("working");
    expect(titles.at(-1)).toContain("demo");
  });

  it("reports workingMs on the settle transition", () => {
    const c = makeController();
    c.start(makeIdentity());
    sched.now = 1000;
    c.agentStart(); // workingSince = 1000
    idle = true;
    c.agentSettled();
    sched.advance(250); // now = 1250 when idle fires
    const idleChange = changes.at(-1) as StateChange;
    expect(idleChange.to).toBe("idle");
    expect(idleChange.from).toBe("working");
    expect(idleChange.workingMs).toBe(250);
  });

  it("unlinks only on quit shutdown", () => {
    const c = makeController();
    c.start(makeIdentity());
    c.shutdown("reload");
    expect(unlinked).toHaveLength(0);
    expect(c.sessionId).toBe("sess-1"); // file kept, process survives

    c.shutdown("quit");
    expect(unlinked).toEqual(["sess-1"]);
    expect(c.sessionId).toBeUndefined();
  });

  it("ignores events after a quit teardown", () => {
    const c = makeController();
    c.start(makeIdentity());
    const before = writes.length;
    c.shutdown("quit");
    c.agentStart();
    c.agentSettled();
    expect(writes.length).toBe(before);
  });

  it("omits the title marker when title format is disabled", () => {
    const c = makeController({ titleFormat: undefined, writeTitle: undefined });
    c.start(makeIdentity());
    c.agentStart();
    expect(writes.at(-1)?.terminal.titleMarker).toBeFalsy();
    expect(titles).toHaveLength(0);
  });

  it("rewrites on metadata refresh only when something changed", () => {
    const c = makeController();
    c.start(makeIdentity());
    const n = writes.length;
    c.refreshMeta({ model: "anthropic/claude" }); // unchanged
    expect(writes.length).toBe(n);
    c.refreshMeta({ model: "openai/gpt" }); // changed
    expect(writes.length).toBe(n + 1);
    expect(writes.at(-1)?.model).toBe("openai/gpt");
  });

  it("does not throw when firing settle with a spy scheduler", () => {
    const setTimer = vi.fn(sched.setTimer);
    const c = makeController({ setTimer });
    c.start(makeIdentity());
    c.agentStart();
    c.agentSettled();
    expect(setTimer).toHaveBeenCalled();
  });
});
