import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Process liveness with PID-reuse protection.
//
// A state file records the owning process's `pid` and `startTime`. A reader
// decides a file is `dormant` when that process is gone, or when the PID has
// been recycled by a *different* process (detected via start-time mismatch).
// ---------------------------------------------------------------------------

/** Result of a liveness probe. */
export type Liveness = "alive" | "gone" | "reused";

/**
 * Two start-time estimates for the same process, taken at different moments by
 * different tools, can differ by ~a second. Treat anything within this window
 * as the same process; a larger gap means the PID was reused.
 */
export const REUSE_TOLERANCE_MS = 2500;

/** Injectable dependencies, so the branching logic is unit-testable. */
export interface LivenessDeps {
  /** Defaults to `process.kill`. Throws with `.code` on failure. */
  kill?: (pid: number, signal: 0) => void;
  /** Defaults to {@link readProcStartTime}. */
  readStartTime?: (pid: number) => number | undefined;
}

/**
 * Best-effort epoch-ms start time of *this* process. Uses `process.uptime()`
 * so it lines up (within {@link REUSE_TOLERANCE_MS}) with a reader's estimate
 * for the same process via {@link readProcStartTime}.
 */
export function readSelfStartTime(): number {
  return Math.round(Date.now() - process.uptime() * 1000);
}

/**
 * Best-effort epoch-ms start time of an arbitrary pid, via `ps -o etimes=`
 * (elapsed seconds; supported on macOS and Linux). Returns `undefined` if the
 * process is gone or `ps` is unavailable.
 */
export function readProcStartTime(pid: number): number | undefined {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "etimes="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    if (!out) return undefined;
    const elapsedSeconds = Number.parseInt(out, 10);
    if (!Number.isFinite(elapsedSeconds)) return undefined;
    return Math.round(Date.now() - elapsedSeconds * 1000);
  } catch {
    return undefined;
  }
}

/**
 * Probe whether the process behind a state file is still the one that wrote it.
 *
 * - `process.kill(pid, 0)` throwing `ESRCH` → the pid is gone.
 * - `EPERM` → the pid exists but is owned by another user; treat as alive.
 * - If `startTime` is provided and the live process with that pid started at a
 *   materially different time, the pid was reused → `reused`.
 */
export function isAlive(pid: number, startTime?: number, deps: LivenessDeps = {}): Liveness {
  const kill = deps.kill ?? ((p: number, s: 0) => process.kill(p, s));
  try {
    kill(pid, 0);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return "alive";
    return "gone";
  }
  if (startTime !== undefined) {
    const read = deps.readStartTime ?? readProcStartTime;
    const actual = read(pid);
    if (actual !== undefined && Math.abs(actual - startTime) > REUSE_TOLERANCE_MS) {
      return "reused";
    }
  }
  return "alive";
}
