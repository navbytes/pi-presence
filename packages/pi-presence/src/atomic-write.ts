import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Atomically write JSON to `target`: serialize into a sibling temp file in the
 * SAME directory, then `rename` over the target (atomic on one filesystem).
 *
 * The temp name is a dotfile ending in `.tmp` so directory readers skip it. No
 * `fsync`: this is ephemeral status data — a crash mid-write is tolerable
 * because the next transition rewrites it and stale reconciliation cleans up.
 */
export function atomicWriteJson(target: string, data: unknown, nonce: string): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(target)}.${nonce}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(data), "utf8");
  try {
    renameSync(tmp, target);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}
