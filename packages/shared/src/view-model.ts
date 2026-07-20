import { basename } from "node:path";
import { PINS_VERSION, type PinsFile, pinMatches } from "./pins.js";
import type { SessionSnapshot } from "./reconcile.js";
import type { LiveState, TerminalInfo } from "./schema.js";

// ---------------------------------------------------------------------------
// The stable, renderer-agnostic view model. pi-watch, the Vee plugin, and any
// standalone NSStatusItem app all render this exact shape, so grouping and
// sort order stay identical everywhere.
// ---------------------------------------------------------------------------

/** Display buckets, in the priority order the plan specifies. */
export type Group = "needs-you" | "running" | "idle" | "dormant";

const GROUP_ORDER: Record<Group, number> = {
  "needs-you": 0,
  running: 1,
  idle: 2,
  dormant: 3,
};

/** Map a live state to its display group. */
export function groupForState(state: LiveState): Group {
  switch (state) {
    case "blocked":
      return "needs-you";
    case "working":
      return "running";
    case "dormant":
      return "dormant";
    default:
      return "idle";
  }
}

/** A single session, flattened for rendering. */
export interface ViewSession {
  id: string;
  /** `sessionName` if set, else the cwd basename, else the id. */
  name: string;
  state: LiveState;
  group: Group;
  cwd: string;
  branch: string | null;
  model: string | null;
  blockedLabel: string | null;
  updatedAt: number;
  /** Age in ms at the time the view model was built. */
  ageMs: number;
  /** Absolute path of the backing state file. */
  path: string;
  sessionFile: string | null;
  terminal: TerminalInfo;
  /** Whether this session is pinned. TUI readers prefix these with 📌; grouping is unchanged. */
  pinned: boolean;
}

export interface ViewCounts {
  needsYou: number;
  running: number;
  idle: number;
  dormant: number;
  total: number;
}

/**
 * One row of the dedicated pinned section (Vee-only this iteration; see
 * PIN-SPEC.md). `session` is the live/dormant match when the pin's backing
 * state file still exists; `null` once it's gone — a "ghost" row rendered
 * from the pin's own cached `name`/`cwd`/`sessionFile` (Resume + Unpin only).
 */
export interface PinnedRow {
  sessionId: string;
  sessionFile: string | null;
  /** The live session's current name, or the pin's cached name once ghosted. */
  name: string;
  /** The live session's current cwd, or the pin's cached cwd once ghosted. */
  cwd: string;
  pinnedAt: number;
  session: ViewSession | null;
}

export interface ViewModel {
  generatedAt: number;
  counts: ViewCounts;
  /** Sorted by group priority, then most-recently-updated first. */
  sessions: ViewSession[];
  /** The 📌 PINNED section: every pin, newest-pinned-first, live or ghost. */
  pinned: PinnedRow[];
}

function deriveName(name: string | null | undefined, cwd: string, id: string): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const base = cwd ? basename(cwd) : "";
  return base || id;
}

/** Build the sorted, grouped, counted view model from reconciled snapshots. */
export function buildViewModel(
  snapshots: SessionSnapshot[],
  now: number = Date.now(),
  pins: PinsFile = { version: PINS_VERSION, pins: [] },
): ViewModel {
  const sessions: ViewSession[] = snapshots.map((s) => {
    const group = groupForState(s.liveState);
    return {
      id: s.file.sessionId,
      name: deriveName(s.file.sessionName, s.file.cwd, s.file.sessionId),
      state: s.liveState,
      group,
      cwd: s.file.cwd,
      branch: s.file.branch ?? null,
      model: s.file.model ?? null,
      blockedLabel: s.liveState === "blocked" ? (s.file.blockedLabel ?? null) : null,
      updatedAt: s.file.updatedAt,
      ageMs: s.ageMs,
      path: s.path,
      sessionFile: s.file.sessionFile ?? null,
      terminal: s.file.terminal ?? {},
      pinned: s.pinned,
    };
  });

  sessions.sort((a, b) => {
    const g = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
    if (g !== 0) return g;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id.localeCompare(b.id);
  });

  const counts: ViewCounts = {
    needsYou: 0,
    running: 0,
    idle: 0,
    dormant: 0,
    total: sessions.length,
  };
  for (const s of sessions) {
    if (s.group === "needs-you") counts.needsYou++;
    else if (s.group === "running") counts.running++;
    else if (s.group === "idle") counts.idle++;
    else counts.dormant++;
  }

  // Newest-pinned-first (design decision #3). `live` prefers the session's
  // CURRENT name/cwd over the pin's cached copy; only a ghost (no match) ever
  // falls back to the cached fields.
  const pinnedRows: PinnedRow[] = pins.pins
    .map((p) => {
      const live = sessions.find((sess) =>
        pinMatches(p, { sessionFile: sess.sessionFile, sessionId: sess.id }),
      );
      return {
        sessionId: p.sessionId,
        sessionFile: p.sessionFile,
        name: live?.name ?? p.name,
        cwd: live?.cwd ?? p.cwd,
        pinnedAt: p.pinnedAt,
        session: live ?? null,
      };
    })
    .sort((a, b) => b.pinnedAt - a.pinnedAt);

  return { generatedAt: now, counts, sessions, pinned: pinnedRows };
}
