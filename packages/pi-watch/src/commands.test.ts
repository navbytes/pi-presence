import type { ViewModel, ViewSession } from "@pi-presence/shared";
import { describe, expect, it, vi } from "vitest";
import { performFocus, resolveSession } from "./commands.js";

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

function vm(sessions: ViewSession[]): ViewModel {
  return {
    generatedAt: 0,
    counts: { needsYou: 0, running: 0, idle: sessions.length, dormant: 0, total: sessions.length },
    sessions,
  };
}

describe("resolveSession", () => {
  const model = vm([
    session({ id: "aaaaaa111111", name: "web", cwd: "/src/web" }),
    session({ id: "bbbbbb222222", name: "api", cwd: "/src/api" }),
    session({ id: "cccccc333333", name: "api", cwd: "/other/api" }),
  ]);

  it("matches an exact id", () => {
    const r = resolveSession(model, "aaaaaa111111");
    expect(r).toMatchObject({ kind: "found", session: { name: "web" } });
  });

  it("matches a short-id suffix", () => {
    const r = resolveSession(model, "111111");
    expect(r).toMatchObject({ kind: "found", session: { id: "aaaaaa111111" } });
  });

  it("matches a unique substring of name or cwd", () => {
    expect(resolveSession(model, "web")).toMatchObject({ kind: "found", session: { name: "web" } });
    expect(resolveSession(model, "/other/")).toMatchObject({
      kind: "found",
      session: { id: "cccccc333333" },
    });
  });

  it("reports ambiguity when a name matches multiple sessions", () => {
    const r = resolveSession(model, "api");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.matches).toHaveLength(2);
  });

  it("returns none for no match or empty query", () => {
    expect(resolveSession(model, "zzz").kind).toBe("none");
    expect(resolveSession(model, "  ").kind).toBe("none");
  });
});

describe("performFocus", () => {
  it("reports a successful focus and does not copy", () => {
    const executeFocus = vi.fn(() => true);
    const copyToClipboard = vi.fn(() => true);
    const out = performFocus(session({ terminal: { itermSessionId: "s" } }), {
      executeFocus,
      copyToClipboard,
    });
    expect(out.focused).toBe(true);
    expect(out.strategy).toBe("iterm2");
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("copies the resume command to the clipboard when focus fails", () => {
    const executeFocus = vi.fn(() => false);
    const copyToClipboard = vi.fn(() => true);
    const out = performFocus(session({ sessionFile: "/x/s.jsonl" }), {
      executeFocus,
      copyToClipboard,
    });
    expect(out.focused).toBe(false);
    expect(out.copied).toBe(true);
    expect(copyToClipboard).toHaveBeenCalledWith("pi --session /x/s.jsonl");
  });
});
