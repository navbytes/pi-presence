import {
  readFileSync as fsReadFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Pin store: <agentDir>/presence-pins.json (see paths.ts's `pinsFilePath`), a
// sibling of live/ so gc and the readers' directory scan never treat it as a
// session file. A pin's identity is `sessionFile` when the session has one
// (stable across resume, per schema.ts); `sessionId` is the fallback for
// sessions with no resolvable file. Writes are read-modify-write + atomic
// temp-file+rename, same shape as the extension's state-file writer
// (packages/pi-presence/src/atomic-write.ts) reimplemented here so this
// package never depends on the extension. Last-write-wins under a race is
// fine: pin/unpin is a rare, human-initiated, idempotent click.
// ---------------------------------------------------------------------------

export const PINS_VERSION = 1;
/** Cap so the pinned section can't become the same scroll-through list it's meant to fix. */
export const PINS_CAP = 20;

/** One pinned session. `cwd`/`name` are cached for ghost-row display only. */
export interface PinEntry {
  /** Primary match key: pi's session `.jsonl` path, if known at pin time. */
  sessionFile: string | null;
  /** Fallback match key, used only for pins with no `sessionFile`. */
  sessionId: string;
  cwd: string;
  name: string;
  pinnedAt: number;
}

export interface PinsFile {
  version: number;
  pins: PinEntry[];
}

function emptyPinsFile(): PinsFile {
  return { version: PINS_VERSION, pins: [] };
}

function isPinEntry(v: unknown): v is PinEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.sessionId === "string" &&
    o.sessionId.length > 0 &&
    (o.sessionFile === null || typeof o.sessionFile === "string") &&
    typeof o.cwd === "string" &&
    typeof o.name === "string" &&
    typeof o.pinnedAt === "number"
  );
}

/**
 * Parse pin-store JSON text. Corrupt/malformed input -> `{ version: 1, pins:
 * [] }`, never throws (mirrors the live-file forward-compat rule). Entries
 * are validated in place, not rebuilt, so any extra fields a newer writer
 * added to an otherwise-valid entry survive a read-modify-write round trip;
 * only a malformed container (or an entry failing validation) is dropped.
 */
export function parsePinsFile(text: string): PinsFile {
  try {
    const raw = JSON.parse(text);
    if (
      typeof raw !== "object" ||
      raw === null ||
      !Array.isArray((raw as { pins?: unknown }).pins)
    ) {
      return emptyPinsFile();
    }
    return { version: PINS_VERSION, pins: (raw as { pins: unknown[] }).pins.filter(isPinEntry) };
  } catch {
    return emptyPinsFile();
  }
}

export interface PinReadDeps {
  readFile?: (path: string) => string;
}

/** Read the pin store at `path`. Absent/corrupt -> `{ version: 1, pins: [] }`, never throws. */
export function readPinsFile(path: string, deps: PinReadDeps = {}): PinsFile {
  const readFile = deps.readFile ?? ((p: string) => fsReadFileSync(p, "utf8"));
  let text: string;
  try {
    text = readFile(path);
  } catch {
    return emptyPinsFile();
  }
  return parsePinsFile(text);
}

/** Atomic temp-file + rename write — same shape as the extension's state-file writer. */
export function writePinsFile(path: string, data: PinsFile): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

/** Does `pin` refer to the same session as `session`? `sessionFile` if the pin has one, else `sessionId`. */
export function pinMatches(
  pin: PinEntry,
  session: { sessionFile?: string | null; sessionId: string },
): boolean {
  return pin.sessionFile
    ? session.sessionFile === pin.sessionFile
    : session.sessionId === pin.sessionId;
}

/** Build a pin entry from a session-shaped value (duck-typed so this module never imports view-model.ts). */
export function toPinEntry(
  session: { sessionFile: string | null; id: string; cwd: string; name: string },
  now: number = Date.now(),
): PinEntry {
  return {
    sessionFile: session.sessionFile,
    sessionId: session.id,
    cwd: session.cwd,
    name: session.name,
    pinnedAt: now,
  };
}

export type PinResult = { ok: true } | { ok: false; error: string };

/**
 * Read-modify-write: pin `entry`'s session, unless it's already pinned
 * (idempotent no-op) or the store is at {@link PINS_CAP} (fails, no write).
 */
export function addPin(path: string, entry: PinEntry): PinResult {
  const current = readPinsFile(path);
  if (current.pins.some((p) => pinMatches(p, entry))) return { ok: true };
  if (current.pins.length >= PINS_CAP) {
    return { ok: false, error: `already at the ${PINS_CAP}-pin limit; unpin something first` };
  }
  writePinsFile(path, { version: PINS_VERSION, pins: [...current.pins, entry] });
  return { ok: true };
}

/** Read-modify-write: remove any pin matching `session`'s identity. No-op if it wasn't pinned. */
export function removePin(
  path: string,
  session: { sessionFile?: string | null; sessionId: string },
): PinResult {
  const current = readPinsFile(path);
  const next = current.pins.filter((p) => !pinMatches(p, session));
  if (next.length !== current.pins.length) {
    writePinsFile(path, { version: PINS_VERSION, pins: next });
  }
  return { ok: true };
}
