import { type FSWatcher, watch as fsWatch } from "node:fs";
import { type ReconcileOptions, type SessionSnapshot, loadAllAndReconcile } from "./reconcile.js";

// ---------------------------------------------------------------------------
// Live-directory watcher.
//
// `fs.watch` on macOS is backed by FSEvents and can miss events or report odd
// rename semantics, so a periodic reconcile is kept as the safety net REGARDLESS
// of watcher health — liveness (a process dying) is not a filesystem event and
// would otherwise never be observed.
// ---------------------------------------------------------------------------

export interface WatchOptions extends ReconcileOptions {
  /** Coalesce bursts of fs events into a single rescan. Default 120ms. */
  debounceMs?: number;
  /** Periodic reconcile interval (liveness + missed-event safety net). Default 5000ms. */
  reconcileIntervalMs?: number;
}

/**
 * Watch `dir` and invoke `onChange` with the reconciled snapshots whenever
 * files change or the periodic reconcile fires. Returns a disposer.
 *
 * `onChange` fires once synchronously-ish on start with the initial scan.
 */
export function watchLive(
  dir: string,
  onChange: (snapshots: SessionSnapshot[]) => void,
  opts: WatchOptions = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 120;
  const intervalMs = opts.reconcileIntervalMs ?? 5000;

  let debTimer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  let stopped = false;

  const rescan = () => {
    debTimer = undefined;
    if (stopped) return;
    onChange(loadAllAndReconcile(dir, opts));
  };

  const schedule = () => {
    if (stopped || debTimer) return;
    debTimer = setTimeout(rescan, debounceMs);
  };

  try {
    watcher = fsWatch(dir, { persistent: true }, schedule);
    // An FSEvents hiccup must not crash the reader; the interval covers gaps.
    watcher.on("error", () => {});
  } catch {
    watcher = undefined; // dir may not exist yet; interval will pick it up
  }

  const interval = setInterval(rescan, intervalMs);
  rescan();

  return () => {
    stopped = true;
    clearInterval(interval);
    if (debTimer) clearTimeout(debTimer);
    try {
      watcher?.close();
    } catch {}
  };
}
