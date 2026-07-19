import { rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";
import { SCHEMA_VERSION, type SessionState, type StateFile, type TerminalInfo } from "./schema.js";

/**
 * Everything about a session that stays constant (or slowly changes) across
 * state transitions. Captured at session start; the state + timestamps are
 * layered on at write time.
 */
export interface SessionIdentity {
  sessionId: string;
  sessionFile: string | null;
  sessionName: string | null;
  cwd: string;
  branch: string | null;
  model: string | null;
  pid: number;
  startTime: number;
  bootId: string | null;
  nonce: string;
  terminal: TerminalInfo;
}

/** Assemble a full {@link StateFile} from identity + current state. */
export function buildStateFile(
  id: SessionIdentity,
  state: SessionState,
  blockedLabel: string | null,
  now: number,
): StateFile {
  return {
    schema: SCHEMA_VERSION,
    sessionId: id.sessionId,
    sessionFile: id.sessionFile,
    sessionName: id.sessionName,
    state,
    blockedLabel: state === "blocked" ? blockedLabel : null,
    cwd: id.cwd,
    branch: id.branch,
    model: id.model,
    pid: id.pid,
    startTime: id.startTime,
    bootId: id.bootId,
    nonce: id.nonce,
    updatedAt: now,
    terminal: id.terminal,
  };
}

/** Atomically write a state file into `liveDir`. */
export function writeState(liveDir: string, file: StateFile): void {
  atomicWriteJson(join(liveDir, `${file.sessionId}.json`), file, file.nonce);
}

/** Remove a session's state file (true teardown). Never throws. */
export function unlinkState(liveDir: string, sessionId: string): void {
  try {
    rmSync(join(liveDir, `${sessionId}.json`), { force: true });
  } catch {
    // already gone / unwritable; nothing to do
  }
}
