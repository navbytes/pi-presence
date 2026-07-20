import { describe, expect, it, vi } from "vitest";
import {
  type LaunchCommand,
  buildLaunchCommand,
  executeLaunch,
  normalizeTerminalName,
  resolveLaunchTerminal,
  resolveTmuxSession,
} from "./launch.js";

describe("normalizeTerminalName", () => {
  it("recognizes app names case-insensitively", () => {
    expect(normalizeTerminalName("iTerm")).toBe("iterm2");
    expect(normalizeTerminalName("iTerm.app")).toBe("iterm2");
    expect(normalizeTerminalName("Ghostty")).toBe("ghostty");
    expect(normalizeTerminalName("ghostty")).toBe("ghostty");
    expect(normalizeTerminalName("Terminal")).toBe("terminal-app");
    expect(normalizeTerminalName("Apple_Terminal")).toBe("terminal-app");
    expect(normalizeTerminalName("tmux")).toBe("tmux");
  });

  it("recognizes bundle ids", () => {
    expect(normalizeTerminalName("com.googlecode.iterm2")).toBe("iterm2");
    expect(normalizeTerminalName("com.mitchellh.ghostty")).toBe("ghostty");
    expect(normalizeTerminalName("com.apple.Terminal")).toBe("terminal-app");
  });

  it("returns null for unknown or empty input", () => {
    expect(normalizeTerminalName("Warp")).toBeNull();
    expect(normalizeTerminalName("")).toBeNull();
    expect(normalizeTerminalName("   ")).toBeNull();
    expect(normalizeTerminalName(null)).toBeNull();
    expect(normalizeTerminalName(undefined)).toBeNull();
  });
});

describe("resolveLaunchTerminal", () => {
  it("prefers explicit config over everything else", () => {
    expect(
      resolveLaunchTerminal({ configured: "Ghostty", recorded: { program: "iTerm.app" } }),
    ).toBe("ghostty");
  });

  it("falls back to the session's recorded terminal.program", () => {
    expect(resolveLaunchTerminal({ recorded: { program: "iTerm.app" } })).toBe("iterm2");
    expect(resolveLaunchTerminal({ recorded: { program: "Apple_Terminal" } })).toBe("terminal-app");
    expect(resolveLaunchTerminal({ recorded: { program: "ghostty" } })).toBe("ghostty");
  });

  it("prefers a recorded tmux pane over the outer program", () => {
    expect(resolveLaunchTerminal({ recorded: { program: "iTerm.app", tmuxPane: "%3" } })).toBe(
      "tmux",
    );
  });

  it("defaults to Terminal.app when nothing is known", () => {
    expect(resolveLaunchTerminal({})).toBe("terminal-app");
    expect(resolveLaunchTerminal({ recorded: {} })).toBe("terminal-app");
    expect(resolveLaunchTerminal({ configured: "", recorded: { program: "" } })).toBe(
      "terminal-app",
    );
  });

  it("ignores an unrecognized explicit config and falls through", () => {
    expect(resolveLaunchTerminal({ configured: "Warp", recorded: { program: "iTerm.app" } })).toBe(
      "iterm2",
    );
  });
});

describe("buildLaunchCommand", () => {
  const target = { piBin: "/opt/homebrew/bin/pi", args: ["--session", "/x/s.jsonl"], cwd: "/proj" };

  it("builds a Terminal.app do-script command with dynamic value via env, not interpolation", () => {
    const cmd = buildLaunchCommand("terminal-app", target);
    expect(cmd.file).toBe("osascript");
    expect(cmd.stdin).toContain('system attribute "PI_RESUME_CMD"');
    expect(cmd.stdin).not.toContain("/proj");
    expect(cmd.env?.PI_RESUME_CMD).toBe("cd /proj && /opt/homebrew/bin/pi --session /x/s.jsonl");
  });

  it("builds an iTerm2 create-window command", () => {
    const cmd = buildLaunchCommand("iterm2", target);
    expect(cmd.file).toBe("osascript");
    expect(cmd.stdin).toContain("create window with default profile");
    expect(cmd.stdin).toContain("write text theCmd");
    expect(cmd.env?.PI_RESUME_CMD).toBe("cd /proj && /opt/homebrew/bin/pi --session /x/s.jsonl");
  });

  it("builds a Ghostty open --args -e command with no shell involved", () => {
    const cmd = buildLaunchCommand("ghostty", target);
    expect(cmd.file).toBe("open");
    expect(cmd.args).toEqual([
      "-na",
      "Ghostty.app",
      "--args",
      "--working-directory=/proj",
      "-e",
      "/opt/homebrew/bin/pi",
      "--session",
      "/x/s.jsonl",
    ]);
    expect(cmd.env).toBeUndefined();
  });

  it("builds a tmux new-window command targeting the recorded pane", () => {
    const cmd = buildLaunchCommand("tmux", { ...target, tmuxTarget: "%7" });
    expect(cmd.file).toBe("tmux");
    expect(cmd.args).toEqual([
      "new-window",
      "-t",
      "%7",
      "-c",
      "/proj",
      "/opt/homebrew/bin/pi --session /x/s.jsonl",
    ]);
  });

  it("omits -t when no tmux pane is known", () => {
    const cmd = buildLaunchCommand("tmux", target);
    expect(cmd.args).not.toContain("-t");
  });

  it("prepends -S <socket> (before the subcommand) when a tmux socket is recorded", () => {
    const cmd = buildLaunchCommand("tmux", {
      ...target,
      tmuxTarget: "%7",
      tmuxSocket: "/tmp/tmux-1000/default",
    });
    expect(cmd.args.slice(0, 3)).toEqual(["-S", "/tmp/tmux-1000/default", "new-window"]);
  });

  it("shell-quotes a session file path with a space and a single quote", () => {
    const odd = {
      piBin: "/opt/homebrew/bin/pi",
      args: ["--session", "/x/a b's.jsonl"],
      cwd: "/a b",
    };
    const terminalApp = buildLaunchCommand("terminal-app", odd);
    expect(terminalApp.env?.PI_RESUME_CMD).toBe(
      "cd '/a b' && /opt/homebrew/bin/pi --session '/x/a b'\\''s.jsonl'",
    );

    const tmux = buildLaunchCommand("tmux", odd);
    expect(tmux.args.at(-1)).toBe("/opt/homebrew/bin/pi --session '/x/a b'\\''s.jsonl'");

    // Ghostty passes argv directly — the space/quote need no escaping at all.
    const ghostty = buildLaunchCommand("ghostty", odd);
    expect(ghostty.args.at(-1)).toBe("/x/a b's.jsonl");
  });

  it("omits the cd prefix when no cwd is known", () => {
    const cmd = buildLaunchCommand("terminal-app", { piBin: "pi", args: [] });
    expect(cmd.env?.PI_RESUME_CMD).toBe("pi");
  });
});

describe("resolveTmuxSession", () => {
  it("returns the trimmed session name from tmux display-message", () => {
    const run = vi.fn(() => "work\n");
    expect(resolveTmuxSession("%4", null, { run })).toBe("work");
    expect(run).toHaveBeenCalledWith("tmux", [
      "display-message",
      "-p",
      "-t",
      "%4",
      "#{session_name}",
    ]);
  });

  it("prepends -S <socket> when a tmux socket is given", () => {
    const run = vi.fn(() => "work\n");
    resolveTmuxSession("%4", "/tmp/tmux-1000/default", { run });
    expect(run).toHaveBeenCalledWith("tmux", [
      "-S",
      "/tmp/tmux-1000/default",
      "display-message",
      "-p",
      "-t",
      "%4",
      "#{session_name}",
    ]);
  });

  it("returns null when tmux throws (pane/session gone)", () => {
    const run = vi.fn(() => {
      throw new Error("can't find pane: %4");
    });
    expect(resolveTmuxSession("%4", null, { run })).toBeNull();
  });

  it("returns null on blank output", () => {
    expect(resolveTmuxSession("%4", null, { run: () => "  \n" })).toBeNull();
  });
});

describe("executeLaunch", () => {
  it("skips macOS-only commands on non-darwin", () => {
    const run = vi.fn();
    const cmd = buildLaunchCommand("terminal-app", { piBin: "pi", args: [] });
    const ok = executeLaunch(cmd, { run, platform: "linux" });
    expect(run).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it("runs tmux on any platform", () => {
    const run = vi.fn();
    const cmd = buildLaunchCommand("tmux", { piBin: "pi", args: [] });
    const ok = executeLaunch(cmd, { run, platform: "linux" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("runs osascript/open on darwin", () => {
    const run = vi.fn();
    const cmd = buildLaunchCommand("ghostty", { piBin: "pi", args: [] });
    const ok = executeLaunch(cmd, { run, platform: "darwin" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("returns false instead of throwing when the command fails", () => {
    const run = vi.fn((_cmd: LaunchCommand) => {
      throw new Error("TCC denied");
    });
    const cmd = buildLaunchCommand("terminal-app", { piBin: "pi", args: [] });
    expect(executeLaunch(cmd, { run, platform: "darwin" })).toBe(false);
  });
});
