import { basename } from "node:path";
import { STATE_ICON, formatTitle } from "./osc-title.js";
import type { SessionState, StateFile } from "./schema.js";
import { type SessionIdentity, buildStateFile } from "./state-writer.js";

// ---------------------------------------------------------------------------
// Event → state machine.
//
// Fully dependency-injected (clock, timers, IO, idle probe) so the transition
// logic — debounce, retry re-check, blocked ref restore, reload/fork rebind — is
// unit-testable with fake timers and no pi runtime.
// ---------------------------------------------------------------------------

export type WriterState = SessionState; // "working" | "blocked" | "idle"

export interface StateChange {
  from: WriterState;
  to: WriterState;
  /** Working duration that just ended (0 unless leaving `working`). */
  workingMs: number;
  file: StateFile;
}

type DefaultTimer = ReturnType<typeof setTimeout>;

export interface PresenceControllerDeps<TTimer = DefaultTimer> {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => TTimer;
  clearTimer: (t: TTimer) => void;
  /** `ctx.isIdle()` — false during a run/retry/compaction/queued continuation. */
  isIdle: () => boolean;
  writeState: (file: StateFile) => void;
  unlinkState: (sessionId: string) => void;
  /** Present only when title emission is enabled AND allowed (tui + tty). */
  writeTitle?: (title: string) => void;
  /** Title format string; when undefined, no title is rendered or recorded. */
  titleFormat?: string;
  /** Side-effect hook (e.g. notifications) fired after every committed change. */
  onStateChange?: (change: StateChange) => void;
  idleDebounceMs: number;
  retryGraceMs: number;
}

export class PresenceController<TTimer = DefaultTimer> {
  private id: SessionIdentity | undefined;
  private state: WriterState = "idle";
  private blockedLabel: string | null = null;
  private prevBeforeBlocked: WriterState = "idle";
  private workingSince: number | undefined;
  private settleTimer: TTimer | undefined;

  constructor(private readonly deps: PresenceControllerDeps<TTimer>) {}

  /** Current writer state (for tests / diagnostics). */
  get currentState(): WriterState {
    return this.state;
  }

  /** The active session id, or undefined after a quit teardown. */
  get sessionId(): string | undefined {
    return this.id?.sessionId;
  }

  /** Bind a (new) session and write the initial `idle` file. */
  start(identity: SessionIdentity): void {
    this.clearSettle();
    this.id = identity;
    this.state = "idle";
    this.blockedLabel = null;
    this.prevBeforeBlocked = "idle";
    this.workingSince = undefined;
    this.commit("idle", 0, this.deps.now());
  }

  /** Update slowly-changing metadata (model, name, branch) and rewrite. */
  refreshMeta(patch: Partial<Pick<SessionIdentity, "model" | "sessionName" | "branch">>): void {
    if (!this.id) return;
    let changed = false;
    if (patch.model !== undefined && patch.model !== this.id.model) {
      this.id.model = patch.model;
      changed = true;
    }
    if (patch.sessionName !== undefined && patch.sessionName !== this.id.sessionName) {
      this.id.sessionName = patch.sessionName;
      changed = true;
    }
    if (patch.branch !== undefined && patch.branch !== this.id.branch) {
      this.id.branch = patch.branch;
      changed = true;
    }
    if (changed) this.commit(this.state, 0, this.deps.now());
  }

  agentStart(): void {
    if (!this.id) return;
    this.clearSettle();
    // A block is a modal wait; don't overwrite it, but remember to restore to
    // working when it clears.
    if (this.state === "blocked") {
      this.prevBeforeBlocked = "working";
      return;
    }
    this.transition("working");
  }

  agentSettled(): void {
    if (!this.id) return;
    this.scheduleSettle(this.deps.idleDebounceMs);
  }

  blocked(label: string | undefined): void {
    if (!this.id) return;
    this.clearSettle();
    this.prevBeforeBlocked = this.state === "working" ? "working" : "idle";
    this.blockedLabel = label ?? null;
    this.transition("blocked");
  }

  unblocked(): void {
    if (!this.id) return;
    this.blockedLabel = null;
    this.transition(this.prevBeforeBlocked);
  }

  /**
   * Teardown. Only `quit` (or process death) removes the file; reload/new/
   * resume/fork keep it because the process survives and the extension is
   * recreated — the next `start()` rebinds.
   */
  shutdown(reason: "quit" | "reload" | "new" | "resume" | "fork"): void {
    this.clearSettle();
    if (reason === "quit" && this.id) {
      this.deps.unlinkState(this.id.sessionId);
      this.id = undefined;
    }
  }

  /** Cancel any pending idle-settle timer. */
  dispose(): void {
    this.clearSettle();
  }

  private scheduleSettle(ms: number): void {
    this.clearSettle();
    this.settleTimer = this.deps.setTimer(() => {
      this.settleTimer = undefined;
      if (!this.id || this.state === "blocked") return; // never override a block
      if (this.deps.isIdle()) {
        this.transition("idle");
      } else {
        // agent_settled fired but a retry/continuation is running; re-check.
        this.scheduleSettle(this.deps.retryGraceMs);
      }
    }, ms);
  }

  private clearSettle(): void {
    if (this.settleTimer !== undefined) {
      this.deps.clearTimer(this.settleTimer);
      this.settleTimer = undefined;
    }
  }

  private transition(to: WriterState): void {
    const from = this.state;
    const now = this.deps.now();
    let workingMs = 0;
    if (from === "working" && this.workingSince !== undefined) {
      workingMs = Math.max(0, now - this.workingSince);
    }
    this.workingSince = to === "working" ? now : undefined;
    this.state = to;
    this.commit(from, workingMs, now);
  }

  private commit(from: WriterState, workingMs: number, now: number): void {
    const id = this.id;
    if (!id) return;
    const to = this.state;

    let title: string | undefined;
    if (this.deps.titleFormat) {
      title = formatTitle(this.deps.titleFormat, {
        name: id.sessionName || basename(id.cwd) || id.sessionId,
        state: to,
        icon: STATE_ICON[to],
        cwd: id.cwd,
        branch: id.branch,
      });
      id.terminal = { ...id.terminal, titleMarker: title };
    }

    const file = buildStateFile(id, to, to === "blocked" ? this.blockedLabel : null, now);
    this.deps.writeState(file);
    if (title !== undefined) this.deps.writeTitle?.(title);
    this.deps.onStateChange?.({ from, to, workingMs, file });
  }
}
