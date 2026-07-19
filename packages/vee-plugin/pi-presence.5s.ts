#!/usr/bin/env node
// <xbar.title>pi presence</xbar.title>
// <xbar.desc>Live status of every pi coding-agent session (needs-you / running / idle / dormant), with click-to-focus.</xbar.desc>
// <xbar.author>Naveen</xbar.author>
// <xbar.author.github>navbytes</xbar.author.github>
// <xbar.version>0.1.0</xbar.version>
// <xbar.dependencies>node,pi-presence-watch</xbar.dependencies>
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
//   If click actions don't run, Vee's GUI PATH may not include the npm global bin;
//   replace `pi-presence-watch` / `pi` below with absolute paths (`which pi`).

import { execFileSync } from "node:child_process";

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

/** Quote an xbar parameter value if it contains anything beyond a safe set. */
export function param(value: string): string {
  if (!/[^A-Za-z0-9_./:@-]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render a view model into xbar/SwiftBar menu lines (title line(s), `---`, body). */
export function renderMenu(vm: ViewModel): string[] {
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
        `${icon} ${s.name} (${short})${detail} | shell=pi-presence-watch param0=focus param1=${param(s.id)} terminal=false tooltip=${param(tip)}`,
      );
      if (s.sessionFile) {
        lines.push(
          `-- Resume in Terminal | shell=pi param0=--session param1=${param(s.sessionFile)} terminal=true`,
        );
      }
      lines.push(
        `-- Focus tab | shell=pi-presence-watch param0=focus param1=${param(s.id)} terminal=false`,
      );
      lines.push(`-- Open folder | shell=open param0=${param(s.cwd)} terminal=false`);
    }
  }

  lines.push("---");
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
    "What is this? | href=https://github.com/navbytes/pi-presence",
  ];
}

function loadViewModel(): ViewModel | null {
  try {
    const out = execFileSync("pi-presence-watch", ["--once", "--json"], {
      encoding: "utf8",
      timeout: 8000,
    });
    return JSON.parse(out) as ViewModel;
  } catch {
    return null;
  }
}

function main(): void {
  const vm = loadViewModel();
  const lines = vm ? renderMenu(vm) : renderMissingCli();
  for (const line of lines) console.log(line);
}

// Run when executed by Vee; stay silent when imported by tests.
if (!process.env.VITEST) main();
