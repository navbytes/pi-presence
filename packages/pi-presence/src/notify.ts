import { execFileSync } from "node:child_process";
import type { SessionState } from "./schema.js";

// ---------------------------------------------------------------------------
// Desktop notifications on the highest-value transitions:
//   - entering `blocked`            → "pi needs you"
//   - `working` → `idle` after work → "pi finished" (only past a duration
//                                     threshold, to avoid spam on quick turns)
//
// Delivery uses `osascript` (zero dependency). The plan's optional branded
// LSUIElement helper app can replace this later; the decision logic is unchanged.
// Fail open: a duplicate notification beats a missed "needs-you".
// ---------------------------------------------------------------------------

export interface Notification {
  title: string;
  message: string;
  /** Which transition produced it (for callers/telemetry). */
  kind: "blocked" | "finished";
}

export interface NotifyDecisionInput {
  from: SessionState;
  to: SessionState;
  /** How long the session was `working` before this transition. */
  workingMs: number;
  /** Minimum working duration for a "finished" notification. */
  thresholdMs: number;
  sessionName: string;
  blockedLabel?: string | null;
}

/** Decide whether a transition warrants a notification, and its content. */
export function decideNotification(input: NotifyDecisionInput): Notification | null {
  const name = input.sessionName || "pi session";
  if (input.to === "blocked") {
    const detail = input.blockedLabel?.trim();
    return {
      kind: "blocked",
      title: "pi needs you",
      message: detail ? `${name}: ${detail}` : `${name} is waiting for you`,
    };
  }
  if (input.to === "idle" && input.from === "working" && input.workingMs >= input.thresholdMs) {
    return {
      kind: "finished",
      title: "pi finished",
      message: `${name} is idle`,
    };
  }
  return null;
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Build the AppleScript for `display notification`. */
export function buildNotifyScript(n: Notification): string {
  return `display notification "${escapeAppleScript(n.message)}" with title "${escapeAppleScript(
    n.title,
  )}"`;
}

export interface NotifyDeps {
  run?: (script: string) => void;
  platform?: NodeJS.Platform;
}

function defaultRun(script: string): void {
  execFileSync("osascript", ["-e", script], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 5000,
  });
}

/** Send a notification (macOS only). Never throws. Returns whether it ran. */
export function sendNotification(n: Notification, deps: NotifyDeps = {}): boolean {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") return false;
  const run = deps.run ?? defaultRun;
  try {
    run(buildNotifyScript(n));
    return true;
  } catch {
    return false;
  }
}
