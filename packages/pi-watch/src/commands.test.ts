import type { LaunchCommand, ViewModel, ViewSession } from "@pi-presence/shared";
import { describe, expect, it, vi } from "vitest";
import { performFocus, performResume, resolveSession } from "./commands.js";

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

describe("performResume", () => {
  it("picks the terminal via PI_PRESENCE_TERMINAL over the recorded program", () => {
    const executeLaunch = vi.fn((_cmd: LaunchCommand) => true);
    const copyToClipboard = vi.fn(() => true);
    const out = performResume(
      session({ sessionFile: "/x/s.jsonl", terminal: { program: "Apple_Terminal" } }),
      "/opt/homebrew/bin/pi",
      { executeLaunch, copyToClipboard, env: { PI_PRESENCE_TERMINAL: "Ghostty" } },
    );
    expect(out.kind).toBe("ghostty");
    expect(out.launched).toBe(true);
    expect(copyToClipboard).not.toHaveBeenCalled();
    const cmd = executeLaunch.mock.calls[0]?.[0];
    expect(cmd?.file).toBe("open");
    expect(cmd?.args).toContain("/opt/homebrew/bin/pi");
  });

  it("falls back to the session's recorded terminal when nothing is configured", () => {
    const executeLaunch = vi.fn(() => true);
    const out = performResume(
      session({ sessionFile: "/x/s.jsonl", terminal: { program: "iTerm.app" } }),
      "pi",
      { executeLaunch, env: {} },
    );
    expect(out.kind).toBe("iterm2");
  });

  it("defaults to Terminal.app when nothing is known", () => {
    const executeLaunch = vi.fn(() => true);
    const out = performResume(session({ sessionFile: "/x/s.jsonl" }), "pi", {
      executeLaunch,
      env: {},
    });
    expect(out.kind).toBe("terminal-app");
  });

  it("copies the resume command to the clipboard when the launch fails", () => {
    const executeLaunch = vi.fn(() => false);
    const copyToClipboard = vi.fn(() => true);
    const out = performResume(session({ sessionFile: "/x/s.jsonl" }), "pi", {
      executeLaunch,
      copyToClipboard,
      env: {},
    });
    expect(out.launched).toBe(false);
    expect(out.copied).toBe(true);
    expect(copyToClipboard).toHaveBeenCalledWith("pi --session /x/s.jsonl");
  });

  it("routes a tmux-recorded session through tmux new-window, resolved to its session name", () => {
    // `new-window -t` rejects a bare pane id ("can't specify pane here",
    // verified live) — performResume must resolve the recorded pane first.
    const executeLaunch = vi.fn((_cmd: LaunchCommand) => true);
    const resolveTmuxSession = vi.fn((pane: string) => (pane === "%4" ? "work" : null));
    const out = performResume(
      session({ sessionFile: "/x/s.jsonl", terminal: { program: "iTerm.app", tmuxPane: "%4" } }),
      "pi",
      { executeLaunch, resolveTmuxSession, env: {} },
    );
    expect(out.kind).toBe("tmux");
    expect(resolveTmuxSession).toHaveBeenCalledWith("%4");
    const cmd = executeLaunch.mock.calls[0]?.[0];
    expect(cmd?.args).toEqual([
      "new-window",
      "-t",
      "work",
      "-c",
      "/home/u/proj",
      "pi --session /x/s.jsonl",
    ]);
  });

  it("falls back to the raw pane id when session resolution fails", () => {
    const executeLaunch = vi.fn((_cmd: LaunchCommand) => true);
    performResume(
      session({ sessionFile: "/x/s.jsonl", terminal: { program: "iTerm.app", tmuxPane: "%9" } }),
      "pi",
      { executeLaunch, resolveTmuxSession: () => null, env: {} },
    );
    const cmd = executeLaunch.mock.calls[0]?.[0];
    expect(cmd?.args).toContain("%9");
  });
});
