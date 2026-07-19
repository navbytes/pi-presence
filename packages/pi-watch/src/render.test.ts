import type { ViewModel, ViewSession } from "@pi-presence/shared";
import { describe, expect, it } from "vitest";
import { humanizeAge, renderSessionLine, renderView, shortId } from "./render.js";

function session(overrides: Partial<ViewSession>): ViewSession {
  return {
    id: "id",
    name: "proj",
    state: "idle",
    group: "idle",
    cwd: "/home/u/proj",
    branch: null,
    model: null,
    blockedLabel: null,
    updatedAt: 0,
    ageMs: 0,
    path: "/live/id.json",
    sessionFile: null,
    terminal: {},
    ...overrides,
  };
}

function model(sessions: ViewSession[]): ViewModel {
  const counts = { needsYou: 0, running: 0, idle: 0, dormant: 0, total: sessions.length };
  for (const s of sessions) {
    if (s.group === "needs-you") counts.needsYou++;
    else if (s.group === "running") counts.running++;
    else if (s.group === "idle") counts.idle++;
    else counts.dormant++;
  }
  return { generatedAt: 0, counts, sessions };
}

describe("humanizeAge", () => {
  it("formats durations", () => {
    expect(humanizeAge(0)).toBe("just now");
    expect(humanizeAge(30_000)).toBe("30s");
    expect(humanizeAge(90_000)).toBe("1m");
    expect(humanizeAge(3 * 3600_000)).toBe("3h");
    expect(humanizeAge(2 * 86_400_000)).toBe("2d");
  });
});

describe("renderView", () => {
  it("shows a header with counts", () => {
    const out = renderView(model([session({ group: "running", state: "working" })]), {
      color: false,
    });
    expect(out[0]).toContain("1 running");
    expect(out[0]).toContain("0 need you");
  });

  it("orders groups needs-you, running, idle, dormant", () => {
    const vm = model([
      session({ id: "d", group: "dormant", state: "dormant", name: "dorm" }),
      session({ id: "r", group: "running", state: "working", name: "run" }),
      session({ id: "b", group: "needs-you", state: "blocked", name: "blk" }),
    ]);
    const text = renderView(vm, { color: false }).join("\n");
    const iNeeds = text.indexOf("NEEDS YOU");
    const iRun = text.indexOf("RUNNING");
    const iDorm = text.indexOf("DORMANT");
    expect(iNeeds).toBeGreaterThanOrEqual(0);
    expect(iNeeds).toBeLessThan(iRun);
    expect(iRun).toBeLessThan(iDorm);
  });

  it("omits empty groups and shows names", () => {
    const text = renderView(model([session({ name: "myproj" })]), { color: false }).join("\n");
    expect(text).toContain("IDLE (1)");
    expect(text).toContain("myproj");
    expect(text).not.toContain("RUNNING");
  });

  it("renders a placeholder when there are no sessions", () => {
    expect(renderView(model([]), { color: false }).join("\n")).toContain("no pi sessions");
  });

  it("emits no ANSI when color is disabled and ANSI when enabled", () => {
    const plain = renderView(model([session({})]), { color: false }).join("\n");
    expect(plain).not.toContain("\x1b[");
    const colored = renderView(model([session({})]), { color: true }).join("\n");
    expect(colored).toContain("\x1b[");
  });

  it("includes the blocked label", () => {
    const line = renderSessionLine(
      session({ state: "blocked", group: "needs-you", blockedLabel: "Allow rm -rf?" }),
      { color: false, now: 0 },
    );
    expect(line).toContain("Allow rm -rf?");
  });

  it("disambiguates look-alike sessions with a short id and model", () => {
    const line = renderSessionLine(
      session({ id: "abc123def456", name: "proj", model: "anthropic/claude", cwd: "/x/proj" }),
      { color: false, now: 0 },
    );
    expect(line).toContain("#def456"); // last 6 of the id
    expect(line).toContain("anthropic/claude");
  });
});

describe("shortId", () => {
  it("returns the last 6 chars for long ids and the whole id when short", () => {
    expect(shortId("abcdef123456")).toBe("123456");
    expect(shortId("abc")).toBe("abc");
  });
});
