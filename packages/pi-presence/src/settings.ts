import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Settings, read from the `pi-presence` block of `<agentDir>/settings.json`.
// All keys are optional; sane defaults apply. Unknown/invalid values fall back
// to the default rather than throwing.
// ---------------------------------------------------------------------------

export interface PresenceSettings {
  /** Master switch. When false the extension writes nothing. */
  enabled: boolean;
  /** Emit the self-labeling terminal title (TUI + TTY only). */
  title: boolean;
  /** Title format string; see {@link formatTitle} placeholders. */
  titleFormat: string;
  /** Fire desktop notifications on blocked / long-run-finished transitions. */
  notify: boolean;
  /** Debounce before an `agent_settled` becomes `idle` (collapses flicker). */
  idleDebounceMs: number;
  /** Re-check delay when a settle fires but the agent is not actually idle. */
  retryGraceMs: number;
  /** Minimum working duration before a "finished" notification fires. */
  notifyThresholdMs: number;
}

export const DEFAULT_SETTINGS: PresenceSettings = {
  enabled: true,
  title: true,
  titleFormat: "{icon} {name} · {state}",
  notify: false,
  idleDebounceMs: 250,
  retryGraceMs: 2500,
  notifyThresholdMs: 10_000,
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function posInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** Merge a raw settings object (already parsed) over the defaults. */
export function parseSettings(raw: unknown): PresenceSettings {
  const block =
    typeof raw === "object" && raw !== null
      ? ((raw as Record<string, unknown>)["pi-presence"] as Record<string, unknown> | undefined)
      : undefined;
  if (!block || typeof block !== "object") return { ...DEFAULT_SETTINGS };
  return {
    enabled: bool(block.enabled, DEFAULT_SETTINGS.enabled),
    title: bool(block.title, DEFAULT_SETTINGS.title),
    titleFormat: str(block.titleFormat, DEFAULT_SETTINGS.titleFormat),
    notify: bool(block.notify, DEFAULT_SETTINGS.notify),
    idleDebounceMs: posInt(block.idleDebounceMs, DEFAULT_SETTINGS.idleDebounceMs),
    retryGraceMs: posInt(block.retryGraceMs, DEFAULT_SETTINGS.retryGraceMs),
    notifyThresholdMs: posInt(block.notifyThresholdMs, DEFAULT_SETTINGS.notifyThresholdMs),
  };
}

/** Read and parse the pi-presence settings block. Never throws. */
export function readSettings(agentDir: string = getAgentDir()): PresenceSettings {
  try {
    const text = readFileSync(join(agentDir, "settings.json"), "utf8");
    return parseSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
