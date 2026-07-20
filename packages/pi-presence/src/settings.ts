import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configDirName, resolveAgentDir } from "./pi-agent-dir.js";

// ---------------------------------------------------------------------------
// Settings, read from the `pi-presence` block of `settings.json`.
//
// Precedence (project wins), matching pi's own config model:
//   1. <agentDir>/settings.json                 (global)
//   2. <cwd>/<CONFIG_DIR_NAME>/settings.json     (project, e.g. .pi/settings.json)
//
// All keys are optional; sane defaults apply. Invalid values fall back to the
// default AND produce a warning so a mistyped key (e.g. `enabled: "false"`) is
// surfaced instead of silently ignored.
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
  /** Debounce after `agent_end` before settling to `idle` (collapses flicker). */
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

export interface SettingsResult {
  settings: PresenceSettings;
  /** Human-readable warnings (malformed files, mistyped keys). */
  warnings: string[];
}

type Block = Record<string, unknown>;

function extractBlock(raw: unknown): Block {
  if (typeof raw !== "object" || raw === null) return {};
  const block = (raw as Record<string, unknown>)["pi-presence"];
  return typeof block === "object" && block !== null ? (block as Block) : {};
}

function boolKey(
  block: Block,
  key: keyof PresenceSettings,
  fallback: boolean,
  warn: string[],
): boolean {
  if (!(key in block)) return fallback;
  const v = block[key];
  if (typeof v === "boolean") return v;
  warn.push(`pi-presence.${key} must be a boolean; got ${typeof v} — using ${fallback}`);
  return fallback;
}

function intKey(
  block: Block,
  key: keyof PresenceSettings,
  fallback: number,
  warn: string[],
): number {
  if (!(key in block)) return fallback;
  const v = block[key];
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  warn.push(
    `pi-presence.${key} must be a non-negative number; got ${JSON.stringify(v)} — using ${fallback}`,
  );
  return fallback;
}

function strKey(
  block: Block,
  key: keyof PresenceSettings,
  fallback: string,
  warn: string[],
): string {
  if (!(key in block)) return fallback;
  const v = block[key];
  if (typeof v === "string" && v.length > 0) return v;
  warn.push(
    `pi-presence.${key} must be a non-empty string; got ${JSON.stringify(v)} — using default`,
  );
  return fallback;
}

function parseBlock(block: Block, warn: string[]): PresenceSettings {
  return {
    enabled: boolKey(block, "enabled", DEFAULT_SETTINGS.enabled, warn),
    title: boolKey(block, "title", DEFAULT_SETTINGS.title, warn),
    titleFormat: strKey(block, "titleFormat", DEFAULT_SETTINGS.titleFormat, warn),
    notify: boolKey(block, "notify", DEFAULT_SETTINGS.notify, warn),
    idleDebounceMs: intKey(block, "idleDebounceMs", DEFAULT_SETTINGS.idleDebounceMs, warn),
    retryGraceMs: intKey(block, "retryGraceMs", DEFAULT_SETTINGS.retryGraceMs, warn),
    notifyThresholdMs: intKey(block, "notifyThresholdMs", DEFAULT_SETTINGS.notifyThresholdMs, warn),
  };
}

/** Merge a single already-parsed settings object over the defaults (no IO). */
export function parseSettings(raw: unknown): PresenceSettings {
  return parseBlock(extractBlock(raw), []);
}

/**
 * Parse a merged `pi-presence` block, returning both settings and any type
 * warnings. `globalRaw` is overlaid by `projectRaw` (project wins per key).
 */
export function resolveSettings(globalRaw: unknown, projectRaw: unknown): SettingsResult {
  const warnings: string[] = [];
  const merged: Block = { ...extractBlock(globalRaw), ...extractBlock(projectRaw) };
  return { settings: parseBlock(merged, warnings), warnings };
}

function readJson(path: string, label: string, warnings: string[]): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined; // absent/unreadable is normal
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    warnings.push(`${label} is not valid JSON (${(err as Error).message}); ignoring it`);
    return undefined;
  }
}

export interface LoadSettingsOptions {
  agentDir?: string;
  /** Project root; its `<CONFIG_DIR_NAME>/settings.json` overrides the global block. */
  cwd?: string;
}

/** Load global + project settings, merged, with warnings. Never throws. */
export function loadSettings(opts: LoadSettingsOptions = {}): SettingsResult {
  const agentDir = opts.agentDir ?? resolveAgentDir();
  const warnings: string[] = [];
  const globalRaw = readJson(join(agentDir, "settings.json"), "global settings.json", warnings);
  const dirName = configDirName();
  const projectRaw = opts.cwd
    ? readJson(
        join(opts.cwd, dirName, "settings.json"),
        `project ${dirName}/settings.json`,
        warnings,
      )
    : undefined;
  const resolved = resolveSettings(globalRaw, projectRaw);
  return { settings: resolved.settings, warnings: [...warnings, ...resolved.warnings] };
}

/** Read merged settings (discarding warnings). */
export function readSettings(agentDir: string = resolveAgentDir()): PresenceSettings {
  return loadSettings({ agentDir }).settings;
}
