import type { ViewModel, ViewSession } from "@pi-presence/shared";
import { describe, expect, it } from "vitest";
import {
  displayWidth,
  humanizeAge,
  renderSessionLine,
  renderView,
  shortId,
  truncEnd,
  truncTail,
} from "./render.js";

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
    pinned: false,
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
  return { generatedAt: 0, counts, sessions, pinned: [] };
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
    const lines = renderSessionLine(
      session({ state: "blocked", group: "needs-you", blockedLabel: "Allow rm -rf?" }),
      { color: false, now: 0 },
    );
    expect(lines.join("\n")).toContain("Allow rm -rf?");
  });

  it("disambiguates look-alike sessions with a short id and model", () => {
    const lines = renderSessionLine(
      session({ id: "abc123def456", name: "proj", model: "anthropic/claude", cwd: "/x/proj" }),
      { color: false, now: 0 },
    );
    expect(lines.join("\n")).toContain("#def456"); // last 6 of the id
    expect(lines.join("\n")).toContain("anthropic/claude");
  });
});

describe("shortId", () => {
  it("returns the last 6 chars for long ids and the whole id when short", () => {
    expect(shortId("abcdef123456")).toBe("123456");
    expect(shortId("abc")).toBe("abc");
  });
});

describe("displayWidth", () => {
  it("counts the status emoji as 2 columns and ✓ as 1", () => {
    expect(displayWidth("⛔")).toBe(2);
    expect(displayWidth("⚡")).toBe(2);
    expect(displayWidth("💤")).toBe(2);
    expect(displayWidth("✓")).toBe(1);
  });

  it("counts plain ASCII as its length", () => {
    expect(displayWidth("hello")).toBe(5);
    expect(displayWidth("")).toBe(0);
  });

  it("strips embedded SGR sequences before measuring", () => {
    expect(displayWidth("\x1b[31mred\x1b[0m")).toBe(3);
  });
});

describe("truncEnd", () => {
  it("returns the string unchanged when it already fits", () => {
    expect(truncEnd("hi", 10)).toBe("hi");
  });

  it("keeps the head and appends an ellipsis when it doesn't fit", () => {
    expect(truncEnd("hello world", 6)).toBe("hello…");
    expect(displayWidth(truncEnd("hello world", 6))).toBeLessThanOrEqual(6);
  });

  it("degrades to a bare ellipsis at max <= 1", () => {
    expect(truncEnd("hello", 1)).toBe("…");
    expect(truncEnd("hello", 0)).toBe("…");
  });
});

describe("truncTail", () => {
  it("returns the string unchanged when it already fits", () => {
    expect(truncTail("hi", 10)).toBe("hi");
  });

  it("keeps the tail (the leaf dir) and prepends an ellipsis when it doesn't fit", () => {
    expect(truncTail("/a/deeply/nested/project/dir", 12)).toBe("…project/dir");
    expect(displayWidth(truncTail("/a/deeply/nested/project/dir", 12))).toBeLessThanOrEqual(12);
  });

  it("degrades to a bare ellipsis at max <= 1", () => {
    expect(truncTail("hello", 1)).toBe("…");
  });
});

describe("renderSessionLine width-responsiveness", () => {
  const wide = session({
    id: "abcdef4d5e6f",
    name: "api-server",
    state: "blocked",
    group: "needs-you",
    cwd: "/Users/naveen/repos/some/deeply/nested/project/dir",
    branch: "feature/very-long-branch-name",
    model: "anthropic/claude-sonnet-5",
    blockedLabel: "Allow rm -rf node_modules && npm install in /Users/x/repos/foo?",
    updatedAt: -60_000,
  });

  it.each([20, 25, 30, 40, 50, 60, 80, 120])("never emits a line wider than width=%i", (width) => {
    const lines = renderSessionLine(wide, { color: false, now: 0, width });
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(width);
  });

  it.each([20, 25, 30, 40, 50, 60, 80, 120])(
    "always includes the (possibly truncated) blocked label at width=%i",
    (width) => {
      const lines = renderSessionLine(wide, { color: false, now: 0, width });
      const text = lines.join("\n");
      // At least a meaningful prefix of the label must survive truncation.
      expect(text).toMatch(/Allow|…/);
    },
  );

  it.each([20, 25, 30, 40, 50, 60, 80, 120])("always includes the name at width=%i", (width) => {
    const lines = renderSessionLine(wide, { color: false, now: 0, width });
    expect(lines[0]).toMatch(/api-s|…/); // truncated head of "api-server" survives, or a bare ellipsis at the floor
  });

  it("drops the model below 80 cols but keeps it at 80+ for typical field lengths", () => {
    const typical = session({
      name: "api-server",
      state: "idle",
      branch: "main",
      model: "anthropic/claude-sonnet-5",
      updatedAt: -60_000,
    });
    expect(renderSessionLine(typical, { color: false, now: 0, width: 60 })[0]).not.toContain(
      "anthropic/claude-sonnet-5",
    );
    expect(renderSessionLine(typical, { color: false, now: 0, width: 80 })[0]).toContain(
      "anthropic/claude-sonnet-5",
    );
  });

  it("cascade-drops model (then branch, then #id) rather than squeezing name to nothing, even at width >= 80", () => {
    // "wide" combines a long branch + model + cwd + label that together don't
    // fit the id/bracket/label budget at 80 cols — model must give way so
    // name (top priority) stays readable instead of collapsing to "…".
    const line = renderSessionLine(wide, { color: false, now: 0, width: 80 })[0] as string;
    expect(line).toContain("api-server"); // name survives, unsquashed
    expect(line).not.toContain("anthropic/claude-sonnet-5"); // model gave way first
  });

  it("drops cwd below 50 cols but shows it (tail-truncated or full) at 50+", () => {
    const narrow = session({ name: "x", cwd: "/a/b/c", updatedAt: -60_000 });
    expect(renderSessionLine(narrow, { color: false, now: 0, width: 45 })[0]).not.toContain(
      "/a/b/c",
    );
    expect(renderSessionLine(narrow, { color: false, now: 0, width: 50 })[0]).toContain("/a/b/c");
  });

  it("puts the blocked label on its own 5-col-indented continuation line when it can't fit inline", () => {
    const lines = renderSessionLine(wide, { color: false, now: 0, width: 40 });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^ {5}— /);
  });

  it("keeps the label inline (single line, head preserved) when there's room", () => {
    const lines = renderSessionLine(wide, { color: false, now: 0, width: 120 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Allow rm -rf"); // head of the sentence, not the trailing cwd
  });

  it("shows the full label inline, untruncated, when it's short enough", () => {
    const short = session({
      name: "x",
      state: "blocked",
      group: "needs-you",
      blockedLabel: "Confirm?",
    });
    const lines = renderSessionLine(short, { color: false, now: 0, width: 120 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("— Confirm?");
  });

  it("pads the 1-col ✓ icon to a 2-col cell so idle names line up with other groups", () => {
    const idleLine = renderSessionLine(session({ name: "x", state: "idle" }), {
      color: false,
      now: 0,
    })[0] as string;
    const workingLine = renderSessionLine(session({ name: "x", state: "working" }), {
      color: false,
      now: 0,
    })[0] as string;
    // Compare DISPLAY COLUMN, not JS string index: "⚡" is 1 UTF-16 code unit
    // but 2 display columns, while the padded "✓ " is 2 code units for the
    // same 2 display columns — the JS indices legitimately differ.
    const idleCol = displayWidth(idleLine.slice(0, idleLine.indexOf("x")));
    const workingCol = displayWidth(workingLine.slice(0, workingLine.indexOf("x")));
    expect(idleCol).toBe(workingCol);
  });

  it("clamps to the width floor of 20 for anything narrower", () => {
    const lines5 = renderSessionLine(wide, { color: false, now: 0, width: 5 });
    const lines20 = renderSessionLine(wide, { color: false, now: 0, width: 20 });
    expect(lines5).toEqual(lines20);
  });
});

describe("renderView width-responsiveness", () => {
  it("never wraps the header, at any width", () => {
    const vm = model([
      session({ id: "a", group: "needs-you", state: "blocked" }),
      session({ id: "b", group: "running", state: "working" }),
      session({ id: "c", group: "idle", state: "idle" }),
      session({ id: "d", group: "dormant", state: "dormant" }),
    ]);
    for (const width of [20, 30, 40, 50, 60, 80, 120]) {
      const header = renderView(vm, { color: false, width })[0] as string;
      expect(displayWidth(header)).toBeLessThanOrEqual(width);
    }
  });

  it("drops lowest-priority chips (dormant, then idle, then running — never needs-you) to fit triple-digit counts", () => {
    const heavy: ViewModel = {
      generatedAt: 0,
      counts: { needsYou: 300, running: 300, idle: 300, dormant: 300, total: 1200 },
      sessions: [],
      pinned: [],
    };
    const header20 = renderView(heavy, { color: false, width: 20 })[0] as string;
    const header40 = renderView(heavy, { color: false, width: 40 })[0] as string;
    expect(displayWidth(header20)).toBeLessThanOrEqual(20);
    expect(displayWidth(header40)).toBeLessThanOrEqual(40);
    expect(header20).toContain("⛔300"); // needs-you chip always survives
    expect(header40).toContain("⛔300");
  });

  it("switches to compact chips below 60 cols and back to the full phrase at 60+", () => {
    const vm = model([session({ group: "running", state: "working" })]);
    expect(renderView(vm, { color: false, width: 59 })[0]).not.toContain("running");
    expect(renderView(vm, { color: false, width: 60 })[0]).toContain("1 running");
  });

  it("keeps existing colour on/off and grouping/ordering behavior with the new width param", () => {
    const plain = renderView(model([session({})]), { color: false, width: 80 }).join("\n");
    expect(plain).not.toContain("\x1b[");
    const colored = renderView(model([session({})]), { color: true, width: 80 }).join("\n");
    expect(colored).toContain("\x1b[");
  });
});

describe("renderSessionLine pinned prefix (📌)", () => {
  const wide = session({
    id: "abcdef4d5e6f",
    name: "api-server",
    state: "blocked",
    group: "needs-you",
    cwd: "/Users/naveen/repos/some/deeply/nested/project/dir",
    branch: "feature/very-long-branch-name",
    model: "anthropic/claude-sonnet-5",
    blockedLabel: "Allow rm -rf node_modules && npm install in /Users/x/repos/foo?",
    updatedAt: -60_000,
  });
  const pinnedWide = { ...wide, pinned: true };

  it("prefixes a pinned row with 📌 in place of the indent", () => {
    const line = renderSessionLine(pinnedWide, { color: false, now: 0, width: 80 })[0] as string;
    expect(line.startsWith("📌")).toBe(true);
  });

  it("omits the pin marker for an unpinned row", () => {
    const line = renderSessionLine(wide, { color: false, now: 0, width: 80 })[0] as string;
    expect(line.startsWith("📌")).toBe(false);
  });

  it("keeps the same total width as the unpinned row — 📌 (2 cols) replaces the 2-col indent", () => {
    const pinnedLine = renderSessionLine(pinnedWide, {
      color: false,
      now: 0,
      width: 80,
    })[0] as string;
    const plainLine = renderSessionLine(wide, { color: false, now: 0, width: 80 })[0] as string;
    expect(displayWidth(pinnedLine)).toBe(displayWidth(plainLine));
  });

  // Reuses the width-invariant harness at the widths called out for this feature (30/40/80)
  // plus the suite's usual spread, to prove 📌 never breaks the fit-to-width guarantee.
  it.each([20, 25, 30, 40, 50, 60, 80, 120])(
    "never emits a pinned line wider than width=%i",
    (width) => {
      const lines = renderSessionLine(pinnedWide, { color: false, now: 0, width });
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(width);
    },
  );

  it.each([30, 40, 80])(
    "always includes the (possibly truncated) name when pinned at width=%i",
    (width) => {
      const lines = renderSessionLine(pinnedWide, { color: false, now: 0, width });
      expect(lines[0]).toMatch(/api-s|…/);
    },
  );
});

describe("renderView with pinned sessions", () => {
  // AC10: the TUI has no dedicated pinned section this iteration — pinned rows
  // stay in their normal group, just prefixed.
  it("AC10: shows a 📌-prefixed row inside its normal group, grouping unchanged", () => {
    const vm = model([
      session({ id: "a", name: "pinned-one", group: "idle", pinned: true }),
      session({ id: "b", name: "plain-one", group: "idle", pinned: false }),
    ]);
    const text = renderView(vm, { color: false }).join("\n");
    expect(text).toContain("IDLE (2)");
    const lines = text.split("\n");
    const pinnedLine = lines.find((l) => l.includes("pinned-one")) as string;
    const plainLine = lines.find((l) => l.includes("plain-one")) as string;
    expect(pinnedLine.startsWith("📌")).toBe(true);
    expect(plainLine.startsWith("📌")).toBe(false);
  });
});
