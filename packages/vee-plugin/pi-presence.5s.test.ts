import { describe, expect, it } from "vitest";
import { param, renderMenu, renderMissingCli, resolveBin } from "./pi-presence.5s.js";

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaa111111",
    name: "web",
    state: "working",
    group: "running",
    cwd: "/home/u/web",
    branch: "main",
    model: "anthropic/claude",
    blockedLabel: null,
    updatedAt: 0,
    sessionFile: "/x/web.jsonl",
    ...overrides,
  };
}

function vm(sessions: ReturnType<typeof session>[]) {
  const counts = { needsYou: 0, running: 0, idle: 0, dormant: 0, total: sessions.length };
  for (const s of sessions) {
    if (s.group === "needs-you") counts.needsYou++;
    else if (s.group === "running") counts.running++;
    else if (s.group === "idle") counts.idle++;
    else counts.dormant++;
  }
  return { counts, sessions };
}

describe("param", () => {
  it("leaves safe values unquoted", () => {
    expect(param("aaaaaa111111")).toBe("aaaaaa111111");
    expect(param("/x/web.jsonl")).toBe("/x/web.jsonl");
  });
  it("quotes and escapes values with spaces or quotes", () => {
    expect(param("/x/a b.jsonl")).toBe('"/x/a b.jsonl"');
    expect(param('a"b')).toBe('"a\\"b"');
  });
});

describe("renderMenu", () => {
  it("puts a red needs-you count in the menu-bar title", () => {
    const out = renderMenu(vm([session({ group: "needs-you", state: "blocked" })]));
    expect(out[0]).toBe("⛔1 | color=red");
    expect(out[1]).toBe("---");
  });

  it("shows a calm title when nothing needs attention", () => {
    expect(renderMenu(vm([session({ group: "idle", state: "idle" })]))[0]).toBe("✓");
  });

  it("groups sessions under headers in priority order with a focus action", () => {
    const text = renderMenu(
      vm([
        session({ id: "r1", name: "run", group: "running", state: "working" }),
        session({
          id: "b1",
          name: "blk",
          group: "needs-you",
          state: "blocked",
          blockedLabel: "Allow rm -rf?",
        }),
      ]),
    ).join("\n");
    expect(text.indexOf("NEEDS YOU (1) | header=true")).toBeLessThan(text.indexOf("RUNNING (1)"));
    expect(text).toContain(
      "⛔ blk (b1) — Allow rm -rf? | shell=pi-presence-watch param0=focus param1=b1",
    );
    expect(text).toContain(
      "-- Resume in Terminal | shell=pi param0=--session param1=/x/web.jsonl terminal=true",
    );
  });

  it("quotes a session file path with spaces in the resume action", () => {
    const text = renderMenu(vm([session({ sessionFile: "/x/a b.jsonl" })])).join("\n");
    expect(text).toContain('param1="/x/a b.jsonl" terminal=true');
  });

  it("renders an empty state", () => {
    const out = renderMenu(vm([]));
    expect(out).toContain("No pi sessions | color=gray");
  });

  it("ends with a refresh action", () => {
    expect(renderMenu(vm([session({})])).at(-1)).toBe("Refresh | refresh=true");
  });
});

describe("renderMissingCli", () => {
  it("tells the user how to install the reader CLI", () => {
    const text = renderMissingCli().join("\n");
    expect(text).toContain("pi-presence-watch not found");
    expect(text).toContain("npm param0=i param1=-g param2=pi-presence-watch");
  });
});

describe("resolveBin", () => {
  it("honors the PI_PRESENCE_WATCH_BIN override", () => {
    expect(
      resolveBin("pi-presence-watch", { PI_PRESENCE_WATCH_BIN: "/custom/pi-presence-watch" }),
    ).toBe("/custom/pi-presence-watch");
  });

  it("falls back to the bare name when nothing resolves", () => {
    expect(resolveBin("definitely-not-a-real-bin-xyz", { PATH: "" })).toBe(
      "definitely-not-a-real-bin-xyz",
    );
  });
});

describe("renderMenu with resolved absolute bins", () => {
  it("uses absolute bin paths in click actions and quotes spaces", () => {
    const text = renderMenu(vm([session({ sessionFile: "/x/web.jsonl" })]), {
      watchBin: "/opt/homebrew/bin/pi-presence-watch",
      piBin: "/Users/a b/bin/pi",
    }).join("\n");
    expect(text).toContain("shell=/opt/homebrew/bin/pi-presence-watch param0=focus");
    expect(text).toContain('shell="/Users/a b/bin/pi" param0=--session');
  });
});
