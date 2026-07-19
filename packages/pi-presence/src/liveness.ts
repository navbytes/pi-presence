/**
 * Best-effort epoch-ms start time of THIS process, used as the PID-reuse guard
 * written into the state file. It is derived from `process.uptime()` so that a
 * pi-free reader estimating the same process's start time via `ps -o etimes=`
 * lands within the reader's reuse tolerance.
 */
export function readSelfStartTime(): number {
  return Math.round(Date.now() - process.uptime() * 1000);
}
