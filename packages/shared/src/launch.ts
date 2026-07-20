import { execFileSync } from "node:child_process";
import type { TerminalInfo } from "./schema.js";

// ---------------------------------------------------------------------------
// Resume-launch: open a NEW terminal window running `pi --session <file>` for
// a dead/dormant session. Distinct from focus.ts (which brings an EXISTING
// window to front) — resume has no window to find, so it has to pick a
// terminal app to open and build that app's "run this command in a new
// window" invocation. Command *generation* is pure and testable, mirroring
// focus.ts's shape.
//
// Resolution order for which app to open, best signal first:
//   1. Explicit config (PI_PRESENCE_TERMINAL / the Vee plugin's xbar.var of
//      the same name) — the user said so.
//   2. The session's own recorded terminal (its tmux pane, else
//      `terminal.program`) — resume where it lived.
//   3. Terminal.app — macOS has no queryable system-wide default terminal
//      (no LaunchServices handler for "the terminal app"), so config +
//      recorded-program is the only reliable signal; this is just the floor.
//
// Same injection-safety approach as focus.ts for the AppleScript-driven
// terminals: script text is a constant, dynamic values travel through the
// environment via `system attribute`, never string interpolation. Ghostty
// and tmux take argv arrays directly (no shell involved on our side), so
// only the *nested* shell command they run needs POSIX quoting.
// ---------------------------------------------------------------------------

export type TerminalKind = "iterm2" | "ghostty" | "terminal-app" | "tmux";

export interface ResolveTerminalOptions {
  /** PI_PRESENCE_TERMINAL (or equivalent) — an app name or bundle id. */
  configured?: string | null;
  /** The session's own terminal snapshot, if known. */
  recorded?: TerminalInfo | null;
}

/** Map a free-form app name or bundle id to a known terminal kind. */
export function normalizeTerminalName(raw: string | null | undefined): TerminalKind | null {
  const s = raw?.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("iterm")) return "iterm2";
  if (s.includes("ghostty")) return "ghostty";
  if (s.includes("tmux")) return "tmux";
  if (s.includes("terminal")) return "terminal-app";
  return null;
}

/** Resolve which terminal to open a resume in. Always returns a kind. */
export function resolveLaunchTerminal(opts: ResolveTerminalOptions): TerminalKind {
  const explicit = normalizeTerminalName(opts.configured);
  if (explicit) return explicit;
  const t = opts.recorded;
  if (t?.tmuxPane) return "tmux";
  return normalizeTerminalName(t?.program) ?? "terminal-app";
}

/** Info needed to build the launch command, once a kind is resolved. */
export interface LaunchTarget {
  /** Absolute (preferred — GUI launchers often have a minimal PATH) or bare path to `pi`. */
  piBin: string;
  /** Args to pi, e.g. `["--session", file]` — see `buildResumeCommand` in focus.ts. */
  args: string[];
  cwd?: string | null;
  /** `terminal.tmuxPane`, used as the tmux `-t` target. */
  tmuxTarget?: string | null;
  /** Socket path parsed from `terminal.tmux` ($TMUX), used as `-S <path>`. */
  tmuxSocket?: string | null;
}

/** A single command to spawn. Mirrors focus.ts's `FocusCommand` shape. */
export interface LaunchCommand {
  file: string;
  args: string[];
  /** Extra env merged over the parent env at spawn time. */
  env?: Record<string, string>;
  /** Written to the child's stdin (used for AppleScript via `osascript`). */
  stdin?: string;
  description: string;
}

// ponytail: duplicated from focus.ts's private shellQuote — packages/shared's
// existing modules are additive-only while this fix ships alongside other
// agents' in-flight edits (see PR description), so this 1-line POSIX quoter
// isn't worth a cross-file export churn for.
function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `<piBin> <args...>`, every token shell-quoted. */
function buildPiCommand(target: LaunchTarget): string {
  return [shellQuote(target.piBin), ...target.args.map(shellQuote)].join(" ");
}

/** `cd <cwd> && <piBin> <args...>` when a cwd is known. */
function buildShellLine(target: LaunchTarget): string {
  const cmd = buildPiCommand(target);
  return target.cwd ? `cd ${shellQuote(target.cwd)} && ${cmd}` : cmd;
}

// Terminal.app has no per-session id and no "run this in a new window" verb
// beyond `do script`, which itself opens a new window when not targeting an
// existing tab.
const TERMINAL_APP_RESUME_SCRIPT = `set theCmd to (system attribute "PI_RESUME_CMD")
tell application "Terminal"
	activate
	do script theCmd
end tell
`;

// iTerm2's documented AppleScript API: create a window, then type into it.
const ITERM2_RESUME_SCRIPT = `set theCmd to (system attribute "PI_RESUME_CMD")
tell application "iTerm2"
	create window with default profile
	tell current session of current window
		write text theCmd
	end tell
end tell
`;

/** Build the command that opens `kind` running the resume command. */
export function buildLaunchCommand(kind: TerminalKind, target: LaunchTarget): LaunchCommand {
  switch (kind) {
    case "terminal-app":
      return {
        file: "osascript",
        args: [],
        stdin: TERMINAL_APP_RESUME_SCRIPT,
        env: { PI_RESUME_CMD: buildShellLine(target) },
        description: "Terminal.app: do script (new window)",
      };
    case "iterm2":
      return {
        file: "osascript",
        args: [],
        stdin: ITERM2_RESUME_SCRIPT,
        env: { PI_RESUME_CMD: buildShellLine(target) },
        description: "iTerm2: create window with default profile",
      };
    case "ghostty": {
      // Ghostty has no window-scripting CLI on macOS — its own `--help`
      // says so: "launching the terminal emulator from the CLI is not
      // supported [...] Use `open -na Ghostty.app --args --foo=bar`
      // instead." `-e` execs the rest of argv directly (no shell on our
      // side, so no quoting needed) and disables shell expansion; verified
      // via `ghostty +show-config --default --docs` (the `command` /
      // `working-directory` keys).
      const args = ["-na", "Ghostty.app", "--args"];
      if (target.cwd) args.push(`--working-directory=${target.cwd}`);
      args.push("-e", target.piBin, ...target.args);
      return { file: "open", args, description: "Ghostty: open -na --args -e (new window)" };
    }
    case "tmux": {
      // `-S <socket>` is a global tmux option and must precede the subcommand.
      const args: string[] = [];
      if (target.tmuxSocket) args.push("-S", target.tmuxSocket);
      args.push("new-window");
      if (target.tmuxTarget) args.push("-t", target.tmuxTarget);
      if (target.cwd) args.push("-c", target.cwd);
      args.push(buildPiCommand(target));
      return { file: "tmux", args, description: "tmux new-window" };
    }
  }
}

export interface ExecuteLaunchDeps {
  /** Runs one command; throws on failure. Defaults to `execFileSync`. */
  run?: (cmd: LaunchCommand) => void;
  platform?: NodeJS.Platform;
}

export interface ResolveTmuxSessionDeps {
  /** Runs a tmux query and returns stdout. Defaults to `execFileSync`. */
  run?: (file: string, args: string[]) => string;
}

function defaultCapture(file: string, args: string[]): string {
  return execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
  });
}

/**
 * Resolve a tmux pane id (`terminal.tmuxPane`, e.g. "%3") to its session
 * name. `new-window -t` targets a window/session, not a pane — tmux rejects
 * `new-window -t %3` outright ("can't specify pane here", verified live on
 * tmux 3.5a) — so a raw recorded pane id has to be resolved to a session
 * first. Best-effort: returns null if tmux or the pane is gone; the caller
 * should fall back to the raw pane id (which will then fail the same way,
 * cleanly) or to no `-t` at all. `socket` (from `terminal.tmux`, the
 * recorded $TMUX) targets a non-default server, e.g. after a reboot dropped
 * the default socket but a custom one (tmux -L/-S) is still running.
 */
export function resolveTmuxSession(
  pane: string,
  socket?: string | null,
  deps: ResolveTmuxSessionDeps = {},
): string | null {
  const run = deps.run ?? defaultCapture;
  const args = socket ? ["-S", socket] : [];
  args.push("display-message", "-p", "-t", pane, "#{session_name}");
  try {
    const name = run("tmux", args).trim();
    return name || null;
  } catch {
    return null;
  }
}

function defaultRun(cmd: LaunchCommand): void {
  execFileSync(cmd.file, cmd.args, {
    input: cmd.stdin ?? undefined,
    env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 5000,
  });
}

/**
 * Best-effort: open the terminal. Returns whether it was attempted without
 * throwing (not whether a window is visibly open — osascript exits 0 even
 * when TCC silently denies Automation permission). `osascript`/`open` are
 * macOS-only; `tmux` runs anywhere tmux is on PATH. Never throws.
 */
export function executeLaunch(cmd: LaunchCommand, deps: ExecuteLaunchDeps = {}): boolean {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  const macOnly = cmd.file === "osascript" || cmd.file === "open";
  if (macOnly && platform !== "darwin") return false;
  try {
    run(cmd);
    return true;
  } catch {
    return false;
  }
}
