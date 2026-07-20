import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installBlockedTracker } from "../src/blocked.js";
import { PresenceController, type PresenceControllerDeps } from "../src/controller.js";
import { readGitBranch } from "../src/git.js";
import { readSelfStartTime } from "../src/liveness.js";
import { decideNotification, sendNotification } from "../src/notify.js";
import { writeTitle } from "../src/osc-title.js";
import { getLiveDir } from "../src/paths.js";
import { DEFAULT_SETTINGS, type PresenceSettings, loadSettings } from "../src/settings.js";
import { type SessionIdentity, unlinkState, writeState } from "../src/state-writer.js";
import { captureTerminal } from "../src/terminal.js";

/** Format a model as `provider/id` (matching pi's own convention), or null. */
function modelIdOf(model: { id?: string; provider?: string } | undefined): string | null {
  if (!model?.id) return null;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

/**
 * pi-presence extension entry point.
 *
 * Writes an atomic per-session state file on every transition and self-labels
 * the terminal tab. Consumes the cooperative `herdr:blocked` convention for
 * the "needs-you" state. See the package README for the schema, settings, and
 * the blocked-state contract.
 */
export default function piPresence(pi: ExtensionAPI): void {
  const liveDir = getLiveDir();
  let lastCtx: ExtensionContext | undefined;
  let warnedWriteFail = false;
  // Settings are (re)resolved in session_start, once ctx (and therefore
  // ctx.isProjectTrusted()) is known. This default only covers the sliver of
  // time before the first session_start; nothing writes before then.
  let settings: PresenceSettings = DEFAULT_SETTINGS;

  const deps: PresenceControllerDeps = {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
    isIdle: () => lastCtx?.isIdle() ?? true,
    writeState: (file) => {
      try {
        writeState(liveDir, file);
      } catch (err) {
        // Never throw out of a handler; warn once so a read-only/full live dir
        // doesn't spam pi's error log on every transition.
        if (!warnedWriteFail) {
          warnedWriteFail = true;
          process.stderr.write(
            `[pi-presence] cannot write state files to ${liveDir} (${(err as Error).message}); presence is disabled for this session\n`,
          );
        }
      }
    },
    unlinkState: (sessionId) => unlinkState(liveDir, sessionId),
    getSessionName: () => pi.getSessionName() ?? null,
    // titleFormat/writeTitle are set per-session once we know the run mode.
    titleFormat: undefined,
    writeTitle: undefined,
    idleDebounceMs: DEFAULT_SETTINGS.idleDebounceMs,
    retryGraceMs: DEFAULT_SETTINGS.retryGraceMs,
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
    return {
      sessionId: sm.getSessionId(),
      sessionFile: sm.getSessionFile() ?? null,
      sessionName: pi.getSessionName() ?? null,
      cwd: ctx.cwd,
      branch: readGitBranch(ctx.cwd),
      model: modelIdOf(ctx.model),
      pid: process.pid,
      startTime: readSelfStartTime(),
      bootId: null,
      nonce: randomUUID(),
      terminal: captureTerminal(),
    };
  };

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;

    // Untrusted project settings must not override the user's own config
    // (docs/extensions.md). Missing isProjectTrusted (pre-0.79.1) => honor
    // project settings as before.
    const projectTrusted = ctx.isProjectTrusted?.() !== false;
    const loaded = loadSettings({ cwd: projectTrusted ? ctx.cwd : undefined });
    for (const w of loaded.warnings) process.stderr.write(`[pi-presence] ${w}\n`);
    settings = loaded.settings;
    deps.idleDebounceMs = settings.idleDebounceMs;
    deps.retryGraceMs = settings.retryGraceMs;
    if (!settings.enabled) return;

    // ctx.ui.setTitle is the sanctioned, mode-safe API (a no-op off-TUI) and is
    // preferred; raw OSC is a fallback for pi versions old enough to lack it,
    // and stays guarded on tui+isTTY since it writes straight to stdout
    // (pi-mono#2388 corrupts RPC JSONL otherwise).
    const setTitle =
      typeof ctx.ui?.setTitle === "function" ? ctx.ui.setTitle.bind(ctx.ui) : undefined;
    const rawOscAllowed = ctx.mode === "tui" && Boolean(process.stdout.isTTY);
    const titleAllowed = settings.title && (setTitle !== undefined || rawOscAllowed);
    deps.titleFormat = titleAllowed ? settings.titleFormat : undefined;
    deps.writeTitle = titleAllowed ? (t) => (setTitle ? setTitle(t) : writeTitle(t)) : undefined;

    const identity = buildIdentity(ctx);
    const previous = controller.sessionId;
    if (previous && previous !== identity.sessionId) {
      // fork/resume produced a new session id; retire the old file.
      unlinkState(liveDir, previous);
    }
    controller.start(identity);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    lastCtx = ctx;
    // A new turn is about to begin; don't let a stale idle-settle timer from
    // the previous turn fire mid-transition.
    controller.cancelPendingIdle();
  });

  pi.on("agent_start", (_event, ctx) => {
    lastCtx = ctx;
    // Model and branch can change between runs; refresh (no-op write if unchanged).
    controller.refreshMeta({ model: modelIdOf(ctx.model), branch: readGitBranch(ctx.cwd) });
    controller.agentStart();
  });

  pi.on("agent_end", (_event, ctx) => {
    lastCtx = ctx;
    controller.agentSettled();
  });

  pi.on("model_select", (event, ctx) => {
    lastCtx = ctx;
    controller.refreshMeta({ model: modelIdOf(event.model) });
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
