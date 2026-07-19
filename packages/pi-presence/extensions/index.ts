import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installBlockedTracker } from "../src/blocked.js";
import { PresenceController, type PresenceControllerDeps } from "../src/controller.js";
import { readGitBranch } from "../src/git.js";
import { readSelfStartTime } from "../src/liveness.js";
import { decideNotification, sendNotification } from "../src/notify.js";
import { writeTitle } from "../src/osc-title.js";
import { getLiveDir } from "../src/paths.js";
import { readSettings } from "../src/settings.js";
import { type SessionIdentity, unlinkState, writeState } from "../src/state-writer.js";
import { captureTerminal } from "../src/terminal.js";

/**
 * pi-presence extension entry point.
 *
 * Writes an atomic per-session state file on every transition and (in TUI on a
 * TTY) self-labels the terminal tab. Consumes the cooperative `herdr:blocked`
 * convention for the "needs-you" state. See the package README for the schema,
 * settings, and the blocked-state contract.
 */
export default function piPresence(pi: ExtensionAPI): void {
  const settings = readSettings();
  if (!settings.enabled) return;

  const liveDir = getLiveDir();
  let lastCtx: ExtensionContext | undefined;

  const deps: PresenceControllerDeps = {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
    isIdle: () => lastCtx?.isIdle() ?? true,
    writeState: (file) => writeState(liveDir, file),
    unlinkState: (sessionId) => unlinkState(liveDir, sessionId),
    // titleFormat/writeTitle are set per-session once we know the run mode.
    titleFormat: undefined,
    writeTitle: undefined,
    idleDebounceMs: settings.idleDebounceMs,
    retryGraceMs: settings.retryGraceMs,
    onStateChange: (change) => {
      if (!settings.notify) return;
      const n = decideNotification({
        from: change.from,
        to: change.to,
        workingMs: change.workingMs,
        thresholdMs: settings.notifyThresholdMs,
        sessionName: change.file.sessionName ?? "",
        blockedLabel: change.file.blockedLabel,
      });
      if (n) sendNotification(n);
    },
  };

  const controller = new PresenceController(deps);

  const buildIdentity = (ctx: ExtensionContext): SessionIdentity => {
    const sm = ctx.sessionManager;
    const sessionId = sm.getSessionId();
    return {
      sessionId,
      sessionFile: sm.getSessionFile() ?? null,
      sessionName: pi.getSessionName() ?? null,
      cwd: ctx.cwd,
      branch: readGitBranch(ctx.cwd),
      model: (ctx.model as { id?: string } | undefined)?.id ?? null,
      pid: process.pid,
      startTime: readSelfStartTime(),
      bootId: null,
      nonce: randomUUID(),
      terminal: captureTerminal(),
    };
  };

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    const titleAllowed = settings.title && ctx.mode === "tui" && Boolean(process.stdout.isTTY);
    deps.titleFormat = titleAllowed ? settings.titleFormat : undefined;
    deps.writeTitle = titleAllowed ? (t) => writeTitle(t) : undefined;

    const identity = buildIdentity(ctx);
    const previous = controller.sessionId;
    if (previous && previous !== identity.sessionId) {
      // fork/resume produced a new session id; retire the old file.
      unlinkState(liveDir, previous);
    }
    controller.start(identity);
  });

  pi.on("agent_start", (_event, ctx) => {
    lastCtx = ctx;
    controller.agentStart();
  });

  pi.on("agent_settled", (_event, ctx) => {
    lastCtx = ctx;
    controller.agentSettled();
  });

  pi.on("session_info_changed", (event, ctx) => {
    lastCtx = ctx;
    controller.refreshMeta({ sessionName: event.name ?? null });
  });

  installBlockedTracker(pi.events, {
    onBlocked: (label) => controller.blocked(label),
    onUnblocked: () => controller.unblocked(),
  });

  pi.on("session_shutdown", (event, ctx) => {
    lastCtx = ctx;
    controller.shutdown(event.reason);
  });
}
