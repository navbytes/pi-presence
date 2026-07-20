import {
  readFileSync as fsReadFileSync,
  readdirSync as fsReaddirSync,
  unlinkSync as fsUnlinkSync,
} from "node:fs";
import { join } from "node:path";
import { type Liveness, isAlive as defaultIsAlive } from "./liveness.js";
import { pinsFilePath } from "./paths.js";
import { type PinsFile, pinMatches, readPinsFile } from "./pins.js";
import { type LiveState, type StateFile, isReadableSchema, normalizeState } from "./schema.js";

// ---------------------------------------------------------------------------
// Directory reconciliation: turn a live/ directory full of <id>.json files into
// a validated, liveness-annotated list of session snapshots, and garbage-
// collect files whose process died long ago.
// ---------------------------------------------------------------------------

/** Default TTL after which a dead session's file is eligible for deletion. */
export const DEFAULT_GC_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** A parsed state file annotated with reader-derived liveness. */
export interface SessionSnapshot {
  /** Absolute path to the state file on disk. */
  path: string;
  /** The parsed, field-normalized state file. */
  file: StateFile;
  /** Raw liveness probe result. */
  liveness: Liveness;
  /** Effective state for display: `dormant` when the process is not alive. */
  liveState: LiveState;
  /** `now - file.updatedAt` in ms. */
  ageMs: number;
  /** Whether this session matches an entry in the pin store. See pins.ts. */
  pinned: boolean;
}

/** Injectable dependencies so reconciliation is unit-testable without real IO. */
export interface ReconcileDeps {
  now?: () => number;
  isAlive?: (pid: number, startTime?: number) => Liveness;
  readdir?: (dir: string) => string[];
  readFile?: (path: string) => string;
  unlink?: (path: string) => void;
}

export interface ReconcileOptions extends ReconcileDeps {
  /** Delete dead files older than this many ms. Only consulted when `prune` is true. */
  gcTtlMs?: number;
  /**
   * Actually unlink dead files past `gcTtlMs`. Defaults to `false`: reading
   * (once/json/live/focus) must never mutate disk — dead files are still
   * returned, just not deleted. Only the explicit `gc` command opts in.
   */
  prune?: boolean;
  /**
   * The pin store to protect pinned sessions from pruning and to annotate
   * `SessionSnapshot.pinned`. Defaults to reading `pinsFilePath(dir)` via the
   * (possibly injected) `readFile`, so callers get correct behavior for free;
   * pass this explicitly only to override (mainly for tests).
   */
  pins?: PinsFile;
}

/** Parse + validate a single state file's raw JSON text. Returns null on any problem. */
export function parseStateFile(text: string): StateFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  // Forward-compat: skip files from a newer, breaking schema.
  if (!isReadableSchema(o.schema)) return null;
  if (typeof o.sessionId !== "string" || o.sessionId.length === 0) return null;
  if (typeof o.pid !== "number" || !Number.isFinite(o.pid)) return null;
  if (typeof o.cwd !== "string") return null;

  const terminal =
    typeof o.terminal === "object" && o.terminal !== null
      ? (o.terminal as StateFile["terminal"])
      : {};

  return {
    schema: o.schema as number,
    sessionId: o.sessionId,
    sessionFile: (o.sessionFile as string | null | undefined) ?? null,
    sessionName: (o.sessionName as string | null | undefined) ?? null,
    state: normalizeState(o.state),
    blockedLabel: (o.blockedLabel as string | null | undefined) ?? null,
    cwd: o.cwd,
    branch: (o.branch as string | null | undefined) ?? null,
    model: (o.model as string | null | undefined) ?? null,
    pid: o.pid,
    startTime: typeof o.startTime === "number" ? o.startTime : 0,
    bootId: (o.bootId as string | null | undefined) ?? null,
    nonce: typeof o.nonce === "string" ? o.nonce : "",
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
    terminal,
  };
}

/**
 * Read every `<id>.json` in `dir`, validate + liveness-annotate each, and
 * (optionally) delete long-dead files. Missing/unreadable dirs yield `[]`.
 */
export function loadAllAndReconcile(dir: string, opts: ReconcileOptions = {}): SessionSnapshot[] {
  const now = opts.now ?? Date.now;
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const readdir = opts.readdir ?? ((d: string) => fsReaddirSync(d));
  const readFile = opts.readFile ?? ((p: string) => fsReadFileSync(p, "utf8"));
  const unlink = opts.unlink ?? ((p: string) => fsUnlinkSync(p));
  const gcTtlMs = opts.gcTtlMs ?? 0;
  const prune = opts.prune ?? false;
  const pins = opts.pins ?? readPinsFile(pinsFilePath(dir), { readFile });

  let entries: string[];
  try {
    entries = readdir(dir);
  } catch {
    return [];
  }

  const snapshots: SessionSnapshot[] = [];
  const nowMs = now();

  for (const name of entries) {
    // Only real state files: skip atomic-write temp files (".<id>.json.<nonce>.tmp") and dotfiles.
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const path = join(dir, name);

    let text: string;
    try {
      text = readFile(path);
    } catch {
      continue; // vanished between readdir and read; ignore
    }

    const file = parseStateFile(text);
    if (!file) continue;

    const liveness = isAlive(file.pid, file.startTime || undefined);
    const ageMs = Math.max(0, nowMs - file.updatedAt);
    const dead = liveness !== "alive";
    const pinned = pins.pins.some((p) => pinMatches(p, file));

    // Protection from expiry is the feature: a pinned session's file is never
    // pruned, regardless of TTL/--all. Unpinning re-exposes it to gc.
    if (dead && prune && gcTtlMs > 0 && ageMs > gcTtlMs && !pinned) {
      try {
        unlink(path);
      } catch {
        // best-effort GC; ignore
      }
      continue;
    }

    snapshots.push({
      path,
      file,
      liveness,
      liveState: dead ? "dormant" : file.state,
      ageMs,
      pinned,
    });
  }

  return snapshots;
}
