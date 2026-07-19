import {
  type FocusPlan,
  type ViewModel,
  type ViewSession,
  buildFocusPlan,
  buildResumeCommand,
  copyToClipboard,
  executeFocus,
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
