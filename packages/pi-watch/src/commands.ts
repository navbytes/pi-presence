import {
  type FocusPlan,
  type LaunchCommand,
  type TerminalKind,
  type ViewModel,
  type ViewSession,
  buildFocusPlan,
  buildLaunchCommand,
  buildResumeCommand,
  copyToClipboard,
  executeFocus,
  executeLaunch,
  resolveLaunchTerminal,
  resolveTmuxSession,
} from "@pi-presence/shared";
import { shortId } from "./render.js";

// ---------------------------------------------------------------------------
// Non-interactive actions for pi-watch: resolve a session from a query and
// focus/resume it. Resolution is pure and tested; the side-effecting focus and
// clipboard calls are injectable.
// ---------------------------------------------------------------------------

export type ResolveResult =
  | { kind: "found"; session: ViewSession }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: ViewSession[] };

/**
 * Resolve a session by query, most specific first:
 *   1. exact id            2. short-id suffix
 *   3. exact name          4. case-insensitive substring of name or cwd
 * A substring match hitting more than one session is reported as ambiguous.
 */
export function resolveSession(vm: ViewModel, query: string): ResolveResult {
  const q = query.trim();
  if (!q) return { kind: "none" };

  const byExactId = vm.sessions.find((s) => s.id === q);
  if (byExactId) return { kind: "found", session: byExactId };

  const byShortId = vm.sessions.filter((s) => shortId(s.id) === q || s.id.endsWith(q));
  if (byShortId.length === 1) return { kind: "found", session: byShortId[0] as ViewSession };

  const byExactName = vm.sessions.filter((s) => s.name === q);
  if (byExactName.length === 1) return { kind: "found", session: byExactName[0] as ViewSession };

  const lower = q.toLowerCase();
  const bySubstring = vm.sessions.filter(
    (s) => s.name.toLowerCase().includes(lower) || s.cwd.toLowerCase().includes(lower),
  );
  if (bySubstring.length === 1) return { kind: "found", session: bySubstring[0] as ViewSession };
  if (bySubstring.length > 1) return { kind: "ambiguous", matches: bySubstring };
  return { kind: "none" };
}

export interface FocusDeps {
  executeFocus?: (plan: FocusPlan) => boolean;
  copyToClipboard?: (text: string) => boolean;
}

export interface FocusOutcome {
  focused: boolean;
  strategy: FocusPlan["strategy"];
  resume: string;
  copied: boolean;
}

/**
 * Try to focus a session's terminal; on failure (or an unknown terminal), copy
 * its resume command to the clipboard as a fallback.
 */
export function performFocus(session: ViewSession, deps: FocusDeps = {}): FocusOutcome {
  const focusFn = deps.executeFocus ?? executeFocus;
  const copyFn = deps.copyToClipboard ?? copyToClipboard;

  const plan = buildFocusPlan({ terminal: session.terminal, cwd: session.cwd });
  const resume = buildResumeCommand({
    sessionFile: session.sessionFile,
    sessionId: session.id,
    cwd: session.cwd,
  }).display;

  const focused = focusFn(plan);
  const copied = focused ? false : copyFn(resume);
  return { focused, strategy: plan.strategy, resume, copied };
}

export interface ResumeDeps {
  executeLaunch?: (cmd: LaunchCommand) => boolean;
  copyToClipboard?: (text: string) => boolean;
  /** Resolves a recorded tmux pane to its session name. See launch.ts. */
  resolveTmuxSession?: (pane: string, socket?: string | null) => string | null;
  /** Defaults to `process.env`; read for `PI_PRESENCE_TERMINAL`. */
  env?: NodeJS.ProcessEnv;
}

export interface ResumeOutcome {
  launched: boolean;
  kind: TerminalKind;
  resume: string;
  copied: boolean;
}

/**
 * Open a dead/dormant session's terminal (the app that recorded it wrote, a
 * PI_PRESENCE_TERMINAL override, or Terminal.app as the last resort) running
 * `pi --session <file>`. Falls back to copying the resume command to the
 * clipboard when nothing could be launched — same fallback shape as
 * {@link performFocus}.
 */
export function performResume(
  session: ViewSession,
  piBin: string,
  deps: ResumeDeps = {},
): ResumeOutcome {
  const launchFn = deps.executeLaunch ?? executeLaunch;
  const copyFn = deps.copyToClipboard ?? copyToClipboard;
  const resolveTmux = deps.resolveTmuxSession ?? resolveTmuxSession;
  const env = deps.env ?? process.env;

  const resumeCmd = buildResumeCommand({
    sessionFile: session.sessionFile,
    sessionId: session.id,
    cwd: session.cwd,
  });
  const kind = resolveLaunchTerminal({
    configured: env.PI_PRESENCE_TERMINAL,
    recorded: session.terminal,
  });
  // `new-window -t` wants a session/window, not a pane — resolve the
  // recorded pane first (falls back to the raw pane id, which then fails the
  // same way tmux would have anyway, if resolution itself is unavailable).
  // `terminal.tmux` is the raw recorded $TMUX ("socketpath,pid,index"); its
  // socket path targets the right server even when it isn't the default one
  // (e.g. a custom -L/-S socket, or the default one is gone after a reboot).
  const pane = session.terminal?.tmuxPane ?? null;
  const tmuxSocket = session.terminal?.tmux?.split(",")[0] || null;
  const tmuxTarget = kind === "tmux" && pane ? (resolveTmux(pane, tmuxSocket) ?? pane) : pane;
  const launchCmd = buildLaunchCommand(kind, {
    piBin,
    args: resumeCmd.args,
    cwd: resumeCmd.cwd,
    tmuxTarget,
    tmuxSocket,
  });

  const launched = launchFn(launchCmd);
  const copied = launched ? false : copyFn(resumeCmd.display);
  return { launched, kind, resume: resumeCmd.display, copied };
}
