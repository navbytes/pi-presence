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
    pinned: false,
    ...overrides,
  };
}

function pinnedRow(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "aaaaaa111111",
    sessionFile: "/x/web.jsonl",
    name: "web",
    cwd: "/home/u/web",
    pinnedAt: 0,
    session: null,
    ...overrides,
  };
}

function vm(sessions: ReturnType<typeof session>[], pinned: ReturnType<typeof pinnedRow>[] = []) {
  const counts = { needsYou: 0, running: 0, idle: 0, dormant: 0, total: sessions.length };
  for (const s of sessions) {
    if (s.group === "needs-you") counts.needsYou++;
    else if (s.group === "running") counts.running++;
    else if (s.group === "idle") counts.idle++;
    else counts.dormant++;
  }
  return { counts, sessions, pinned };
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
    // Resume dispatches through `pi-presence-watch resume` (which picks the
    // terminal itself) rather than asking xbar to run `pi` inside Terminal.app.
    expect(text).toContain(
      "-- Resume in Terminal | shell=pi-presence-watch param0=resume param1=b1 param2=--pi-bin param3=pi terminal=false",
    );
  });

  it("routes Resume in Terminal through pi-presence-watch resume with the session id", () => {
    const text = renderMenu(vm([session({ id: "abc123", sessionFile: "/x/web.jsonl" })])).join(
      "\n",
    );
    expect(text).toContain(
      "-- Resume in Terminal | shell=pi-presence-watch param0=resume param1=abc123 param2=--pi-bin param3=pi terminal=false",
    );
  });

  it("quotes the pi-bin value in the resume action when it has spaces", () => {
    const text = renderMenu(vm([session({ sessionFile: "/x/web.jsonl" })]), {
      piBin: "/Users/a b/bin/pi",
    }).join("\n");
    expect(text).toContain('param3="/Users/a b/bin/pi" terminal=false');
  });

  it("omits Resume in Terminal when the session has no session file", () => {
    const text = renderMenu(vm([session({ sessionFile: null })])).join("\n");
    expect(text).not.toContain("Resume in Terminal");
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
    // Resume shells out to the (absolute) watch bin too; the resolved pi bin
    // travels through as --pi-bin so `pi-presence-watch resume` can launch it.
    expect(text).toContain(
      'shell=/opt/homebrew/bin/pi-presence-watch param0=resume param1=aaaaaa111111 param2=--pi-bin param3="/Users/a b/bin/pi" terminal=false',
    );
  });
});

describe("📌 PINNED section", () => {
  // AC1/AC3: a pinned session shows in a top-of-menu 📌 PINNED section, above NEEDS YOU.
  it("AC1: renders above NEEDS YOU with its live icon/state and an Unpin action", () => {
    const liveSession = session({
      id: "b1",
      name: "blk",
      group: "needs-you",
      state: "blocked",
      pinned: true,
    });
    // A second, unpinned needs-you session so "NEEDS YOU" actually appears — the
    // pinned one is excluded from it (see the next test).
    const unpinnedNeedsYou = session({
      id: "b2",
      name: "other",
      group: "needs-you",
      state: "blocked",
    });
    const text = renderMenu(
      vm(
        [liveSession, unpinnedNeedsYou],
        [pinnedRow({ sessionId: "b1", name: "blk", session: liveSession })],
      ),
    ).join("\n");
    expect(text.indexOf("📌 PINNED (1) | header=true")).toBeLessThan(text.indexOf("NEEDS YOU"));
    expect(text).toContain("⛔ blk (b1)");
    expect(text).toContain("-- Unpin | shell=pi-presence-watch param0=unpin param1=b1");
  });

  // AC2: unpinning removes the row from 📌 PINNED; the session stays visible in its
  // normal group throughout (modeled here as the before/after view models a real
  // unpin produces — pinned:false and no entry in `pinned` once the store is updated).
  it("AC2: after unpinning, the row leaves 📌 PINNED and stays in its normal group", () => {
    const pinnedSession = session({
      id: "b1",
      name: "blk",
      group: "needs-you",
      state: "blocked",
      pinned: true,
    });
    const beforeText = renderMenu(
      vm([pinnedSession], [pinnedRow({ sessionId: "b1", name: "blk", session: pinnedSession })]),
    ).join("\n");
    expect(beforeText).toContain("📌 PINNED (1)");
    expect(beforeText).not.toContain("NEEDS YOU (1)");

    const unpinnedSession = { ...pinnedSession, pinned: false };
    const afterText = renderMenu(vm([unpinnedSession], [])).join("\n");
    expect(afterText).not.toContain("PINNED");
    expect(afterText).toContain("NEEDS YOU (1)");
    expect(afterText).toContain("⛔ blk (b1)");
  });

  // Design decision #3: a pinned session appears in the PINNED section ONLY, not duplicated in its group.
  it("does not duplicate a pinned session in its normal state group", () => {
    const liveSession = session({
      id: "b1",
      name: "blk",
      group: "needs-you",
      state: "blocked",
      pinned: true,
    });
    const text = renderMenu(
      vm([liveSession], [pinnedRow({ sessionId: "b1", name: "blk", session: liveSession })]),
    ).join("\n");
    expect(text).not.toContain("NEEDS YOU (1)");
    expect((text.match(/blk \(b1\)/g) ?? []).length).toBe(1);
  });

  it("shows a Pin action (not Unpin) for an unpinned session", () => {
    const text = renderMenu(vm([session({ id: "s1" })])).join("\n");
    expect(text).toContain("-- Pin | shell=pi-presence-watch param0=pin param1=s1");
    expect(text).not.toContain("Unpin");
  });

  // AC7: a ghost pin (state file gone) renders with only Resume + Unpin — never a crash.
  it("AC7: renders a ghost row (no live session) with only Resume + Unpin", () => {
    const text = renderMenu(
      vm([], [pinnedRow({ sessionId: "g1", name: "old-task", cwd: "/x/old", session: null })]),
    ).join("\n");
    expect(text).toContain("💤 old-task (g1)");
    expect(text).toContain(
      "-- Resume in Terminal | shell=pi-presence-watch param0=resume param1=g1 param2=--pi-bin param3=pi terminal=false",
    );
    expect(text).toContain("-- Unpin | shell=pi-presence-watch param0=unpin param1=g1");
    expect(text).not.toContain("Focus tab");
    expect(text).not.toContain("Open folder");
    expect(text).not.toContain("-- Pin ");
  });

  it("omits the section entirely when nothing is pinned", () => {
    const text = renderMenu(vm([session({})])).join("\n");
    expect(text).not.toContain("PINNED");
  });

  it("tolerates a missing `pinned` field (older CLI JSON) without crashing", () => {
    const legacyVm = {
      counts: { needsYou: 0, running: 1, idle: 0, dormant: 0, total: 1 },
      sessions: [session({})],
    };
    expect(() => renderMenu(legacyVm as never)).not.toThrow();
  });
});

describe("Prune sessions dormant >24h action", () => {
  it("counts only dormant sessions past the 24h gc TTL, matching what gc actually prunes", () => {
    const text = renderMenu(
      vm([session({ id: "d1", state: "dormant", group: "dormant", updatedAt: 0 })]),
    ).join("\n");
    expect(text).toContain(
      "Prune sessions dormant >24h (1) | shell=pi-presence-watch param0=gc terminal=false refresh=true",
    );
  });

  it("excludes a dormant session that hasn't hit the 24h TTL yet", () => {
    const text = renderMenu(
      vm([
        session({ id: "d1", state: "dormant", group: "dormant", updatedAt: Date.now() - 60_000 }),
      ]),
    ).join("\n");
    expect(text).not.toContain("Prune sessions dormant");
  });

  // gc never prunes a pinned file regardless of TTL, so a pinned dormant session must not
  // inflate this count either — it stays truthful about what the click actually prunes.
  it("excludes a TTL-expired dormant session that is pinned (gc would skip it)", () => {
    const pinnedDormant = session({
      id: "d1",
      state: "dormant",
      group: "dormant",
      updatedAt: 0,
      pinned: true,
    });
    const text = renderMenu(
      vm([pinnedDormant], [pinnedRow({ sessionId: "d1", session: pinnedDormant })]),
    ).join("\n");
    expect(text).not.toContain("Prune sessions dormant");
  });

  it("hides the prune action when nothing is dormant", () => {
    const text = renderMenu(vm([session({})])).join("\n");
    expect(text).not.toContain("Prune sessions dormant");
  });
});
