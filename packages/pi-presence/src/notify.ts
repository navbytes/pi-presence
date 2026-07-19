import { execFileSync } from "node:child_process";
import type { SessionState } from "./schema.js";

// ---------------------------------------------------------------------------
// Desktop notifications on the highest-value transitions:
//   - entering `blocked`            → "pi needs you"
//   - `working` → `idle` after work → "pi finished" (only past a duration
//                                     threshold, to avoid spam on quick turns)
//
// Delivery is zero-dependency and cross-platform: macOS → `osascript`,
// Linux → `notify-send`. Fail open: a duplicate notification beats a missed
// "needs-you".
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

export type NotifySender = "osascript" | "notify-send";

export interface NotifyCommand {
  file: string;
  args: string[];
}

/** The notification sender for a platform, or null if unsupported. */
export function senderFor(platform: NodeJS.Platform): NotifySender | null {
  if (platform === "darwin") return "osascript";
  if (platform === "linux") return "notify-send";
  return null;
}

/** Build the spawn command for a given sender. */
export function buildNotifyCommand(n: Notification, sender: NotifySender): NotifyCommand {
  if (sender === "osascript") {
    return { file: "osascript", args: ["-e", buildNotifyScript(n)] };
  }
  return { file: "notify-send", args: [n.title, n.message] };
}

export interface NotifyDeps {
  run?: (cmd: NotifyCommand) => void;
  platform?: NodeJS.Platform;
}

function defaultRun(cmd: NotifyCommand): void {
  execFileSync(cmd.file, cmd.args, {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 5000,
  });
}

/** Send a notification (macOS/Linux). Never throws. Returns whether it ran. */
export function sendNotification(n: Notification, deps: NotifyDeps = {}): boolean {
  const platform = deps.platform ?? process.platform;
  const sender = senderFor(platform);
  if (!sender) return false;
  const run = deps.run ?? defaultRun;
  try {
    run(buildNotifyCommand(n, sender));
    return true;
  } catch {
    return false;
  }
}
