#!/usr/bin/env node
// <xbar.title>pi presence</xbar.title>
// <xbar.desc>Live status of every pi coding-agent session (needs-you / running / idle / dormant), with click-to-focus.</xbar.desc>
// <xbar.author>Naveen</xbar.author>
// <xbar.author.github>navbytes</xbar.author.github>
// <xbar.version>0.1.1</xbar.version>
// <xbar.dependencies>node,pi-presence-watch</xbar.dependencies>
// <xbar.var>string(PI_PRESENCE_WATCH_BIN=): Absolute path to the pi-presence-watch binary, if it isn't auto-found.
// <xbar.var>string(PI_PRESENCE_TERMINAL=): Terminal app to open on Resume (e.g. "iTerm", "Ghostty", "Terminal"). Defaults to the session's own recorded terminal, then Terminal.app.
// <vee.exec>Runs `pi-presence-watch` to read session state and focus terminals.</vee.exec>
// <vee.filter>true</vee.filter>
// <vee.shortcut>cmd+shift+p</vee.shortcut>
// <vee.surface>menu</vee.surface>
// <vee.timeout>10s</vee.timeout>
//
// A Vee / xbar / SwiftBar plugin for pi-presence. It is a single, self-contained
// file: copy it into your Vee plugins folder and it works.
//
//   Setup:
//     1. npm i -g pi-presence-watch        (the reader CLI this plugin renders)
//     2. cp pi-presence.5s.ts "~/Library/Application Support/Vee/plugins/"
//     3. chmod +x "~/Library/Application Support/Vee/plugins/pi-presence.5s.ts"
//
//   Rename the interval in the filename to change cadence (e.g. pi-presence.10s.ts).
//   Requires Node 24+ (Vee runs .ts directly, no build step).
//
//   GUI apps like Vee run with a minimal PATH that usually omits the npm global
//   bin, so this plugin resolves `pi-presence-watch` / `pi` to absolute paths
//   itself (checking $PI_PRESENCE_WATCH_BIN, the dir of the node running this
//   plugin, $PATH, and common install dirs). If it still can't find them, set
//   PI_PRESENCE_WATCH_BIN in the plugin's Vee settings to the output of
//   `which pi-presence-watch`.

import { execFileSync } from "node:child_process";
import { constants, accessSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface Session {
  id: string;
  name: string;
  state: string;
  group: string;
  cwd: string;
  branch: string | null;
  model: string | null;
  blockedLabel: string | null;
  updatedAt: number;
  sessionFile: string | null;
}

interface ViewModel {
  counts: { needsYou: number; running: number; idle: number; dormant: number; total: number };
  sessions: Session[];
}

const ICON: Record<string, string> = { working: "⚡", blocked: "⛔", idle: "✓", dormant: "💤" };
const GROUP_TITLE: Record<string, string> = {
  "needs-you": "NEEDS YOU",
  running: "RUNNING",
  idle: "IDLE",
  dormant: "DORMANT",
};
const GROUP_ORDER = ["needs-you", "running", "idle", "dormant"];
// Mirrors packages/shared/src/reconcile.ts's DEFAULT_GC_TTL_MS — duplicated
// because this plugin is a single copyable file with no imports from
// @pi-presence/shared. `gc` only prunes dormant files past this age.
const GC_TTL_MS = 24 * 60 * 60 * 1000;

/** Quote an xbar parameter value if it contains anything beyond a safe set. */
export function param(value: string): string {
  if (!/[^A-Za-z0-9_./:@-]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Resolve an executable to an absolute path, tolerant of the minimal PATH that
 * GUI apps (Vee) inherit. Order: explicit override, the dir of the node running
 * this plugin (npm global bins usually sit beside it), $PATH, common install
 * dirs. Falls back to the bare name (PATH lookup at exec time).
 */
export function resolveBin(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const dirs: string[] = [];
  const override = name === "pi-presence-watch" ? env.PI_PRESENCE_WATCH_BIN?.trim() : undefined;
  if (override) return override;

  dirs.push(dirname(process.execPath));
  for (const d of (env.PATH ?? "").split(":")) if (d) dirs.push(d);
  dirs.push(
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    join(homedir(), ".npm-global", "bin"),
    join(homedir(), ".local", "bin"),
  );

  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here; keep looking
    }
  }
  return name;
}

export interface RenderOptions {
  /** Absolute path (or bare name) of pi-presence-watch, used in click actions. */
  watchBin?: string;
  /** Absolute path (or bare name) of pi, used in the resume action. */
  piBin?: string;
}

/** Render a view model into xbar/SwiftBar menu lines (title line(s), `---`, body). */
export function renderMenu(vm: ViewModel, opts: RenderOptions = {}): string[] {
  const watch = param(opts.watchBin ?? "pi-presence-watch");
  const pi = param(opts.piBin ?? "pi");
  const c = vm.counts;
  const lines: string[] = [];

  const parts: string[] = [];
  if (c.needsYou) parts.push(`⛔${c.needsYou}`);
  if (c.running) parts.push(`⚡${c.running}`);
  const title = parts.length > 0 ? parts.join(" ") : "✓";
  lines.push(c.needsYou > 0 ? `${title} | color=red` : title);

  lines.push("---");

  if (vm.sessions.length === 0) {
    lines.push("No pi sessions | color=gray");
  }

  const byGroup = new Map<string, Session[]>();
  for (const s of vm.sessions) {
    const list = byGroup.get(s.group) ?? [];
    list.push(s);
    byGroup.set(s.group, list);
  }

  for (const group of GROUP_ORDER) {
    const list = byGroup.get(group);
    if (!list || list.length === 0) continue;
    lines.push(`${GROUP_TITLE[group]} (${list.length}) | header=true`);
    for (const s of list) {
      const short = s.id.length > 6 ? s.id.slice(-6) : s.id;
      const detail = s.state === "blocked" && s.blockedLabel ? ` — ${s.blockedLabel}` : "";
      const tip = [s.cwd, s.branch, s.model].filter(Boolean).join("  ·  ");
      const icon = ICON[s.state] ?? "•";
      // Primary click: focus the terminal (falls back to copying the resume
      // command to the clipboard — handled by `pi-presence-watch focus`).
      lines.push(
        `${icon} ${s.name} (${short})${detail} | shell=${watch} param0=focus param1=${param(s.id)} terminal=false tooltip=${param(tip)}`,
      );
      if (s.sessionFile) {
        // Resume dispatches through `pi-presence-watch resume`, which picks the
        // right terminal app itself (PI_PRESENCE_TERMINAL, else the session's
        // own recorded terminal, else Terminal.app) — terminal=false because
        // we're launching the terminal ourselves, not asking xbar to run this
        // command inside one.
        lines.push(
          `-- Resume in Terminal | shell=${watch} param0=resume param1=${param(s.id)} param2=--pi-bin param3=${pi} terminal=false`,
        );
      }
      lines.push(`-- Focus tab | shell=${watch} param0=focus param1=${param(s.id)} terminal=false`);
      lines.push(`-- Open folder | shell=open param0=${param(s.cwd)} terminal=false`);
    }
  }

  lines.push("---");
  // `gc` (no --all) only prunes dormant files past the 24h TTL, not every
  // dormant session shown above — count just the gc-eligible ones so the
  // number matches what the click actually prunes.
  const now = Date.now();
  const gcEligible = vm.sessions.filter(
    (s) => s.state === "dormant" && now - s.updatedAt > GC_TTL_MS,
  ).length;
  if (gcEligible > 0) {
    lines.push(
      `Prune sessions dormant >24h (${gcEligible}) | shell=${watch} param0=gc terminal=false refresh=true`,
    );
  }
  lines.push("Refresh | refresh=true");
  return lines;
}

/** Lines shown when the reader CLI isn't available. */
export function renderMissingCli(): string[] {
  return [
    "pi ⚠️",
    "---",
    "pi-presence-watch not found | color=red",
    "Install it | shell=npm param0=i param1=-g param2=pi-presence-watch terminal=true",
    "Or set PI_PRESENCE_WATCH_BIN in this plugin's settings | color=gray",
    "What is this? | href=https://github.com/navbytes/pi-presence",
  ];
}

function loadViewModel(watchBin: string): ViewModel | null {
  try {
    const out = execFileSync(watchBin, ["--once", "--json"], {
      encoding: "utf8",
      timeout: 8000,
    });
    return JSON.parse(out) as ViewModel;
  } catch {
    return null;
  }
}

function main(): void {
  const watchBin = resolveBin("pi-presence-watch");
  const piBin = resolveBin("pi");
  const vm = loadViewModel(watchBin);
  const lines = vm ? renderMenu(vm, { watchBin, piBin }) : renderMissingCli();
  for (const line of lines) console.log(line);
}

// Run when executed by Vee; stay silent when imported by tests.
if (!process.env.VITEST) main();
