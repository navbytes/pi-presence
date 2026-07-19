import type { Group, LiveState, ViewModel, ViewSession } from "@pi-presence/shared";

// ---------------------------------------------------------------------------
// Pure renderer: ViewModel -> lines of text (optionally ANSI-colored). Kept
// separate from the terminal driver so it is fully unit-testable.
// ---------------------------------------------------------------------------

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
};

const STATE_ICON: Record<LiveState, string> = {
  working: "⚡",
  blocked: "⛔",
  idle: "✓",
  dormant: "💤",
};

const GROUP_TITLE: Record<Group, string> = {
  "needs-you": "NEEDS YOU",
  running: "RUNNING",
  idle: "IDLE",
  dormant: "DORMANT",
};

const GROUP_COLOR: Record<Group, keyof typeof ANSI> = {
  "needs-you": "red",
  running: "yellow",
  idle: "green",
  dormant: "gray",
};

const GROUP_ORDER: Group[] = ["needs-you", "running", "idle", "dormant"];

export interface RenderOptions {
  color?: boolean;
  now?: number;
}

/** Human-readable relative age, e.g. "just now", "3m", "2h", "5d". */
export function humanizeAge(ms: number): string {
  if (ms < 5_000) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function paint(text: string, color: keyof typeof ANSI, enabled: boolean): string {
  return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

/** Render one session as a single line. */
export function renderSessionLine(s: ViewSession, opts: RenderOptions = {}): string {
  const color = opts.color ?? false;
  const now = opts.now ?? Date.now();
  const icon = STATE_ICON[s.state];
  const name = paint(s.name, "bold", color);
  const meta: string[] = [];
  if (s.branch) meta.push(paint(s.branch, "cyan", color));
  meta.push(paint(humanizeAge(Math.max(0, now - s.updatedAt)), "dim", color));
  const detail = s.state === "blocked" && s.blockedLabel ? ` — ${s.blockedLabel}` : "";
  return `  ${icon} ${name}  ${paint(s.cwd, "dim", color)}  [${meta.join(" · ")}]${detail}`;
}

/** Render the whole view model into lines. */
export function renderView(vm: ViewModel, opts: RenderOptions = {}): string[] {
  const color = opts.color ?? false;
  const c = vm.counts;
  const header = paint(
    `pi-presence · ${c.needsYou} need you · ${c.running} running · ${c.idle} idle · ${c.dormant} dormant`,
    "bold",
    color,
  );
  const lines: string[] = [header, ""];

  const byGroup = new Map<Group, ViewSession[]>();
  for (const s of vm.sessions) {
    const list = byGroup.get(s.group) ?? [];
    list.push(s);
    byGroup.set(s.group, list);
  }

  let any = false;
  for (const group of GROUP_ORDER) {
    const list = byGroup.get(group);
    if (!list || list.length === 0) continue;
    any = true;
    lines.push(paint(`${GROUP_TITLE[group]} (${list.length})`, GROUP_COLOR[group], color));
    for (const s of list) lines.push(renderSessionLine(s, opts));
    lines.push("");
  }

  if (!any) lines.push(paint("  no pi sessions", "dim", color));
  return lines;
}
