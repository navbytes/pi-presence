// ---------------------------------------------------------------------------
// Parse a human-friendly duration for `gc --ttl` (D6): a bare number of
// seconds, or a number suffixed with s/m/h/d. Pure, so it's unit-testable.
// ---------------------------------------------------------------------------

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse e.g. "90s", "30m", "2h", "1d", or a bare "90" (seconds) into
 * milliseconds. Returns `undefined` for anything else (empty, negative,
 * zero, non-numeric, unknown unit).
 */
export function parseDuration(input: string): number | undefined {
  const m = /^(\d+)(s|m|h|d)?$/.exec(input.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1] as string, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n * UNIT_MS[(m[2] as string) ?? "s"];
}
