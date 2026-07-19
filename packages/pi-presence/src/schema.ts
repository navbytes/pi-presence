// ---------------------------------------------------------------------------
// pi-presence state-file schema (canonical).
//
// This file is the single source of truth for the on-disk state-file format.
// It is intentionally dependency-free (no pi imports, no Node imports) so that
// non-pi readers can consume it without pulling in the pi peer packages.
//
// A byte-identical copy lives at `packages/pi-presence/src/schema.ts`. The
// extension ships its own copy so its published tarball does not depend on the
// private workspace `shared` package. `scripts/check-schema-sync.mjs` asserts
// the two files are byte-identical in CI. If you edit this file, copy it over.
// ---------------------------------------------------------------------------

/**
 * On-disk schema version. Integer. Bump ONLY on a breaking file-format change.
 *
 * Readers MUST ignore files whose `schema` is greater than the version they
 * understand (forward-compat), and MUST treat unknown `state` values as `idle`.
 */
export const SCHEMA_VERSION = 1;

/**
 * States the writer (the pi extension) can emit.
 *
 * `dormant` is deliberately NOT here: it is a reader-derived state produced when
 * a file's process is no longer alive. The writer only ever emits these three.
 */
export type SessionState = "working" | "blocked" | "idle";

/** States a reader may surface, including the reader-derived `dormant`. */
export type LiveState = SessionState | "dormant";

/**
 * Terminal-correlation snapshot captured once at session start.
 *
 * Every field is best-effort: it is present only if the corresponding
 * environment variable was set in the pi process. Readers use these to focus
 * the originating terminal tab (see `focus.ts`).
 */
export interface TerminalInfo {
  /** `$TERM_PROGRAM`, e.g. "iTerm.app", "Apple_Terminal", "ghostty". */
  program?: string | null;
  /** `$ITERM_SESSION_ID` — unique per iTerm2 session, survives tab moves. */
  itermSessionId?: string | null;
  /** `$TERM_SESSION_ID` — generic per-session id (Terminal.app, others). */
  termSessionId?: string | null;
  /** Presence marker for `$GHOSTTY_RESOURCES_DIR` / `$GHOSTTY_BIN_DIR`. */
  ghosttyResource?: string | null;
  /** `$WINDOWID` if set (X11-style window id). */
  windowId?: string | null;
  /** `$TMUX` server socket, if running inside tmux. */
  tmux?: string | null;
  /** `$TMUX_PANE`, if running inside tmux. */
  tmuxPane?: string | null;
  /** The last OSC title string we emitted; a last-resort match key. */
  titleMarker?: string | null;
}

/**
 * The full on-disk state file. One file per pi session id, written atomically
 * to `<agentDir>/live/<sessionId>.json` on every state transition.
 */
export interface StateFile {
  /** Schema version this file was written with. See {@link SCHEMA_VERSION}. */
  schema: number;
  /** pi session id (stable per session file). Also the file's basename. */
  sessionId: string;
  /** Absolute path to the pi session `.jsonl`, if known. */
  sessionFile?: string | null;
  /** Human-readable session name (`pi.getSessionName()`), if set. */
  sessionName?: string | null;
  /** Current writer-emitted state. */
  state: SessionState;
  /** Present only when `state === "blocked"`; the prompt/reason shown. */
  blockedLabel?: string | null;
  /** Working directory of the pi process. */
  cwd: string;
  /** Git branch (`sessionManager.getBranch()`-derived), if resolvable. */
  branch?: string | null;
  /** Active model id (`ctx.model`), if known. */
  model?: string | null;
  /** `process.pid` of the owning pi process (liveness key). */
  pid: number;
  /** Process start time in epoch ms; guards against PID reuse. */
  startTime: number;
  /** Optional boot nonce for stronger PID-reuse detection. */
  bootId?: string | null;
  /** Session-scoped uuid written once at start (tmp-file suffix + identity). */
  nonce: string;
  /** Epoch ms of the last write. Used for TTL-based GC. */
  updatedAt: number;
  /** Terminal-correlation snapshot. */
  terminal: TerminalInfo;
}

/** The set of writer-emitted states, for runtime validation. */
const WRITER_STATES: ReadonlySet<string> = new Set<SessionState>(["working", "blocked", "idle"]);

/** Type guard: is `value` a state the writer can legitimately emit? */
export function isSessionState(value: unknown): value is SessionState {
  return typeof value === "string" && WRITER_STATES.has(value);
}

/**
 * Normalize a raw `state` field read from disk. Per the forward-compat rule,
 * any unknown value collapses to `"idle"` so a newer writer never wedges an
 * older reader.
 */
export function normalizeState(value: unknown): SessionState {
  return isSessionState(value) ? value : "idle";
}

/**
 * Whether a reader that understands {@link SCHEMA_VERSION} may parse a file
 * declaring `schema`. Files from a newer, breaking schema are skipped.
 */
export function isReadableSchema(schema: unknown): boolean {
  return typeof schema === "number" && Number.isFinite(schema) && schema <= SCHEMA_VERSION;
}
