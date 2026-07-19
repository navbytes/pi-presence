import { execFileSync } from "node:child_process";
import type { TerminalInfo } from "./schema.js";

// ---------------------------------------------------------------------------
// Click-to-focus: turn a session's terminal snapshot into the commands that
// bring its tab to the front. Command *generation* is pure and testable; the
// scripts pass dynamic values through the environment (never string
// interpolation) so they are injection-safe and produce constant script text.
//
// Correlation strength, best to worst: iTerm2 session id -> Ghostty cwd+title
// marker -> Terminal.app title marker -> tmux pane. Unknown terminals get no
// plan and the caller should fall back to copying the resume command.
// ---------------------------------------------------------------------------

export type FocusStrategy = "iterm2" | "ghostty" | "terminal-app" | "tmux" | "none";

/** A single command to spawn. `stdin` and `env` are optional. */
export interface FocusCommand {
  file: string;
  args: string[];
  /** Extra env merged over the parent env at spawn time. */
  env?: Record<string, string>;
  /** Written to the child's stdin (used for AppleScript via `osascript`). */
  stdin?: string;
  description: string;
}

export interface FocusPlan {
  strategy: FocusStrategy;
  commands: FocusCommand[];
}

export interface FocusTarget {
  terminal: TerminalInfo;
  /** Working directory, used as the Ghostty correlation key. */
  cwd?: string;
}

// iTerm2 Python API. Verified calls: get_session_by_id + async_activate +
// app.async_activate. Requires "Enable Python API" in iTerm2 settings.
const ITERM2_PY = `import os, sys
try:
    import iterm2
except Exception:
    sys.exit(2)
async def main(connection):
    app = await iterm2.async_get_app(connection)
    sid = os.environ.get("PI_FOCUS_SID", "")
    session = app.get_session_by_id(sid) if sid else None
    if session is None:
        sys.exit(3)
    await session.async_activate(select_tab=True, order_window_front=True)
    await app.async_activate()
iterm2.run_until_complete(main)
`;

// Ghostty AppleScript (1.3.0+, preview). The terminal class exposes title and
// working directory but not PID/TTY (issue #11592), so match on the title
// marker first, then fall back to the working directory.
const GHOSTTY_SCRIPT = `set theCwd to (system attribute "PI_FOCUS_CWD")
set theMarker to (system attribute "PI_FOCUS_MARKER")
tell application "Ghostty"
	set target to missing value
	if theMarker is not "" then
		try
			set ms to (every terminal whose title contains theMarker)
			if (count of ms) > 0 then set target to item 1 of ms
		end try
	end if
	if target is missing value and theCwd is not "" then
		try
			set ms to (every terminal whose working directory contains theCwd)
			if (count of ms) > 0 then set target to item 1 of ms
		end try
	end if
	if target is not missing value then
		focus target
		activate
	end if
end tell
`;

// Terminal.app has no per-session id; match a tab by the OSC title marker.
const TERMINAL_APP_SCRIPT = `set theMarker to (system attribute "PI_FOCUS_MARKER")
if theMarker is "" then return
tell application "Terminal"
	repeat with w in windows
		repeat with t in tabs of w
			set matched to false
			try
				if (custom title of t) contains theMarker then set matched to true
			end try
			if not matched then
				try
					if (name of t) contains theMarker then set matched to true
				end try
			end if
			if matched then
				set selected of t to true
				set index of w to 1
				set frontmost of w to true
				activate
				return
			end if
		end repeat
	end repeat
end tell
`;

function isGhostty(t: TerminalInfo): boolean {
  return Boolean(t.ghosttyResource) || (t.program?.toLowerCase().includes("ghostty") ?? false);
}

/** Build the ordered focus commands for a session's terminal. */
export function buildFocusPlan(target: FocusTarget): FocusPlan {
  const t = target.terminal ?? {};
  const commands: FocusCommand[] = [];

  // Inside tmux: select the pane/window before focusing the outer terminal.
  if (t.tmuxPane) {
    commands.push({
      file: "tmux",
      args: ["select-window", "-t", t.tmuxPane],
      description: "tmux select-window",
    });
    commands.push({
      file: "tmux",
      args: ["select-pane", "-t", t.tmuxPane],
      description: "tmux select-pane",
    });
  }

  let strategy: FocusStrategy = "none";

  if (t.itermSessionId || t.program === "iTerm.app") {
    strategy = "iterm2";
    commands.push({
      file: "python3",
      args: ["-c", ITERM2_PY],
      env: { PI_FOCUS_SID: t.itermSessionId ?? "" },
      description: "iTerm2 async_activate by session id",
    });
  } else if (isGhostty(t)) {
    strategy = "ghostty";
    commands.push({
      file: "osascript",
      args: [],
      stdin: GHOSTTY_SCRIPT,
      env: { PI_FOCUS_CWD: target.cwd ?? "", PI_FOCUS_MARKER: t.titleMarker ?? "" },
      description: "Ghostty focus by title/cwd",
    });
  } else if (t.program === "Apple_Terminal") {
    strategy = "terminal-app";
    commands.push({
      file: "osascript",
      args: [],
      stdin: TERMINAL_APP_SCRIPT,
      env: { PI_FOCUS_MARKER: t.titleMarker ?? "" },
      description: "Terminal.app focus by title marker",
    });
  } else if (t.tmuxPane) {
    strategy = "tmux";
  }

  return { strategy, commands };
}

/** Info needed to build a resume command. */
export interface ResumeTarget {
  sessionFile?: string | null;
  sessionId?: string | null;
  cwd?: string | null;
}

/** A command to relaunch/resume a session, plus a copy-pasteable display string. */
export interface ResumeCommand {
  file: string;
  args: string[];
  cwd?: string;
  display: string;
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the command that resumes a session: `pi --session <file>` when the
 * session file is known, else `pi --session-id <id>`, else bare `pi`, run in the
 * recorded cwd.
 */
export function buildResumeCommand(target: ResumeTarget): ResumeCommand {
  const args: string[] = [];
  if (target.sessionFile) args.push("--session", target.sessionFile);
  else if (target.sessionId) args.push("--session-id", target.sessionId);
  const cwd = target.cwd ?? undefined;
  const display = ["pi", ...args.map(shellQuote)].join(" ");
  return { file: "pi", args, cwd, display };
}

export interface ExecuteFocusDeps {
  /** Runs one command; throws on non-zero exit. Defaults to `execFileSync`. */
  run?: (cmd: FocusCommand) => void;
  platform?: NodeJS.Platform;
}

function defaultRun(cmd: FocusCommand): void {
  execFileSync(cmd.file, cmd.args, {
    input: cmd.stdin ?? undefined,
    env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 5000,
  });
}

/**
 * Best-effort execution of a focus plan. Returns whether a strategy was
 * attempted (not whether focus visibly succeeded — AppleScript exits 0 even
 * when it matches nothing). AppleScript/iTerm2 steps are macOS-only; tmux steps
 * run anywhere. Never throws.
 */
export function executeFocus(plan: FocusPlan, deps: ExecuteFocusDeps = {}): boolean {
  if (plan.strategy === "none") return false;
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  let attempted = false;
  for (const cmd of plan.commands) {
    const macOnly = cmd.file === "osascript" || cmd.file === "python3";
    if (macOnly && platform !== "darwin") continue;
    try {
      run(cmd);
      attempted = true;
    } catch {
      // best-effort; continue to the next command
    }
  }
  return attempted || (plan.strategy === "tmux" && plan.commands.length > 0);
}
