import { describe, expect, it, vi } from "vitest";
import { type FocusCommand, buildFocusPlan, buildResumeCommand, executeFocus } from "./focus.js";

describe("buildFocusPlan", () => {
  it("uses the iTerm2 session-id strategy", () => {
    const plan = buildFocusPlan({ terminal: { itermSessionId: "w0t1p0:UUID" } });
    expect(plan.strategy).toBe("iterm2");
    const cmd = plan.commands.at(-1) as FocusCommand;
    expect(cmd.file).toBe("python3");
    expect(cmd.env?.PI_FOCUS_SID).toBe("w0t1p0:UUID");
    expect(cmd.args[1]).toContain("async_activate");
    expect(cmd.args[1]).toContain("order_window_front=True");
  });

  it("uses Ghostty cwd+marker strategy", () => {
    const plan = buildFocusPlan({
      terminal: { program: "ghostty", titleMarker: "⚡ nt · working" },
      cwd: "/home/u/proj",
    });
    expect(plan.strategy).toBe("ghostty");
    const cmd = plan.commands[0] as FocusCommand;
    expect(cmd.file).toBe("osascript");
    expect(cmd.env?.PI_FOCUS_CWD).toBe("/home/u/proj");
    expect(cmd.env?.PI_FOCUS_MARKER).toBe("⚡ nt · working");
    // script text is constant; dynamic values come from env, not interpolation
    expect(cmd.stdin).toContain('system attribute "PI_FOCUS_CWD"');
    expect(cmd.stdin).not.toContain("/home/u/proj");
  });

  it("uses Terminal.app title-marker strategy", () => {
    const plan = buildFocusPlan({ terminal: { program: "Apple_Terminal", titleMarker: "MARK" } });
    expect(plan.strategy).toBe("terminal-app");
    expect(plan.commands[0]?.env?.PI_FOCUS_MARKER).toBe("MARK");
  });

  it("prepends tmux pane selection", () => {
    const plan = buildFocusPlan({ terminal: { itermSessionId: "s", tmuxPane: "%3" } });
    expect(plan.commands[0]).toMatchObject({ file: "tmux", args: ["select-window", "-t", "%3"] });
    expect(plan.commands[1]).toMatchObject({ file: "tmux", args: ["select-pane", "-t", "%3"] });
    expect(plan.strategy).toBe("iterm2");
  });

  it("falls back to tmux-only strategy when the outer terminal is unknown", () => {
    const plan = buildFocusPlan({ terminal: { tmuxPane: "%1" } });
    expect(plan.strategy).toBe("tmux");
  });

  it("returns strategy none for an unknown terminal", () => {
    const plan = buildFocusPlan({ terminal: {} });
    expect(plan.strategy).toBe("none");
    expect(plan.commands).toHaveLength(0);
  });
});

describe("buildResumeCommand", () => {
  it("prefers the session file", () => {
    const r = buildResumeCommand({ sessionFile: "/x/s.jsonl", sessionId: "s", cwd: "/proj" });
    expect(r.args).toEqual(["--session", "/x/s.jsonl"]);
    expect(r.cwd).toBe("/proj");
    expect(r.display).toBe("pi --session /x/s.jsonl");
  });

  it("falls back to session id", () => {
    const r = buildResumeCommand({ sessionId: "abc" });
    expect(r.args).toEqual(["--session-id", "abc"]);
  });

  it("shell-quotes odd paths in the display string", () => {
    const r = buildResumeCommand({ sessionFile: "/x/a b.jsonl" });
    expect(r.display).toBe("pi --session '/x/a b.jsonl'");
  });

  it("bare pi when nothing is known", () => {
    expect(buildResumeCommand({}).display).toBe("pi");
  });
});

describe("executeFocus", () => {
  it("returns false for strategy none", () => {
    expect(executeFocus({ strategy: "none", commands: [] })).toBe(false);
  });

  it("skips macOS-only commands on non-darwin but runs tmux", () => {
    const run = vi.fn();
    const plan = buildFocusPlan({ terminal: { itermSessionId: "s", tmuxPane: "%2" } });
    executeFocus(plan, { run, platform: "linux" });
    // only the two tmux commands should run
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every(([c]) => (c as FocusCommand).file === "tmux")).toBe(true);
  });

  it("runs osascript on darwin", () => {
    const run = vi.fn();
    const plan = buildFocusPlan({ terminal: { program: "Apple_Terminal", titleMarker: "M" } });
    const ok = executeFocus(plan, { run, platform: "darwin" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("does not throw when a command fails", () => {
    const run = vi.fn(() => {
      throw new Error("boom");
    });
    const plan = buildFocusPlan({ terminal: { program: "Apple_Terminal", titleMarker: "M" } });
    expect(() => executeFocus(plan, { run, platform: "darwin" })).not.toThrow();
  });
});
