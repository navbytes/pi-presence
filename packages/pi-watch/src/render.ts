import type { Group, LiveState, ViewModel, ViewSession } from "@pi-presence/shared";

// ---------------------------------------------------------------------------
// Pure renderer: ViewModel -> lines of text (optionally ANSI-colored). Kept
// separate from the terminal driver so it is fully unit-testable.
//
// Width-responsive: every line is measured/truncated in DISPLAY columns and
// reshaped to fit RenderOptions.width (default 80) instead of letting the
// terminal hard-wrap it — see the narrow-pane UX review for the field-
// priority table this implements. Truncation always runs on plain text;
// color is applied last so an SGR sequence never gets sliced in half.
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

// U+1F4CC, an astral codepoint -> already 2 display cols via displayWidth's
// generic astral rule, same width as the 2-space indent it replaces below.
const PIN_MARK = "📌";

export interface RenderOptions {
  color?: boolean;
  now?: number;
  /** Terminal width in columns; content is truncated/reshaped to fit. Default 80. */
  width?: number;
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

/** A short, stable session-id suffix to disambiguate look-alike sessions. */
export function shortId(id: string): string {
  return id.length <= 6 ? id : id.slice(-6);
}

// Display columns for the tiny non-ASCII set this renderer emits. The status
// emoji are double-width; ✓ and · — are single; astral code points (most
// emoji, incl. 💤) are double; ambiguous BMP glyphs like ✓ stay 1.
// ponytail: covers our glyphs + latin session names, not full CJK — YAGNI here.
const WIDE = new Set(["⛔", "⚡", "💤"]); // U+26D4 / U+26A1 / U+1F4A4
const SGR = /\x1b\[[0-9;]*m/g;

/** Display-column width of `s`, ignoring embedded ANSI SGR sequences. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s.replace(SGR, "")) {
    w += WIDE.has(ch) || (ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
  }
  return w;
}

const ELL = "…"; // 1 col

/**
 * Truncate to `max` display columns, keeping the head (for names). Operates
 * on plain text — never call this on already-colored text (see module doc).
 */
export function truncEnd(s: string, max: number): string {
  if (displayWidth(s) <= max) return s;
  if (max <= 1) return ELL;
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + ELL;
}

/**
 * Truncate to `max` display columns, keeping the tail (for cwd — the leaf dir
 * is what disambiguates, not the head) or a blocked label's last clause.
 */
export function truncTail(s: string, max: number): string {
  if (displayWidth(s) <= max) return s;
  if (max <= 1) return ELL;
  const chars = [...s];
  let w = 0;
  let out = "";
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = displayWidth(chars[i] as string);
    if (w + cw > max - 1) break;
    out = chars[i] + out;
    w += cw;
  }
  return ELL + out;
}

/** Pad a status icon into a fixed 2-column cell (✓ is 1 col; ⛔⚡💤 are already 2). */
function padIcon(icon: string): string {
  return displayWidth(icon) >= 2 ? icon : `${icon} `;
}

interface MetaPart {
  text: string;
  color: keyof typeof ANSI;
}

/** Minimum cols name gets to keep before model/branch/#id cascade off (see below). */
const MIN_NAME = 8;
/** Minimum cols an inline blocked label gets to keep before it moves to its own line. */
const LABEL_MIN = 15;

/** 5-col-indented continuation line for a blocked label that has no room inline. */
function blockedContinuationLine(label: string, width: number): string {
  const prefix = "     — "; // 5-col indent + "— " marker, 7 cols total
  const budget = Math.max(1, width - displayWidth(prefix));
  // Deviation from the review's literal pseudocode (`truncTail(label, W-5)`):
  // a blocked label is a sentence ("Allow rm -rf ... in <cwd>?"), not a path —
  // its subject is at the HEAD, which is exactly what C2 says the user scans
  // for ("who needs me and why"). truncTail's tail-bias is C3's reasoning for
  // cwd (the leaf dir disambiguates); it doesn't apply here, so this keeps the
  // head (truncEnd) instead. Noted in the PR body per the "say so" instruction.
  return prefix + truncEnd(label, budget);
}

/**
 * Render one session as 1 line, or 2 when a blocked label needs its own
 * indented continuation line. Field priority (highest width first): name and
 * age are always shown; model drops below 80 cols, branch/#id below 60,
 * cwd below 50 (at which point a blocked label also moves to its own line).
 * name truncates (end-ellipsis) only once nothing else is left to drop; cwd
 * tail-truncates (keeps the leaf dir) into whatever room remains; an inline
 * blocked label end-truncates (keeps the actionable head of the sentence).
 */
export function renderSessionLine(s: ViewSession, opts: RenderOptions = {}): string[] {
  const color = opts.color ?? false;
  const now = opts.now ?? Date.now();
  const width = Math.max(opts.width ?? 80, 20);

  let showModel = width >= 80 && Boolean(s.model);
  let showBranch = width >= 60 && Boolean(s.branch);
  let showId = width >= 60;
  const showCwd = width >= 50 && Boolean(s.cwd);
  const inlineLabel = width >= 50;
  const blockedLabel = s.state === "blocked" ? s.blockedLabel : null;

  const icon = padIcon(STATE_ICON[s.state]);
  const age = humanizeAge(Math.max(0, now - s.updatedAt));
  const labelReserve = blockedLabel && inlineLabel ? LABEL_MIN + 3 : 0; // 3 = " — "

  // id and the meta bracket are shown whole or not at all (never partially
  // truncated); whatever's left of the width budget goes to name + cwd, the
  // two fields that DO truncate. name is top priority and must never be
  // squeezed to nothing to make room for lower-priority fields, so if the
  // width-tier gate above still leaves too little room for a usable name,
  // cascade-drop model, then branch, then #id (the documented drop order)
  // until name gets at least MIN_NAME cols back.
  let idText: string;
  let plainBracket: string;
  let paintedBracket: string;
  let contentBudget: number;
  for (;;) {
    idText = showId ? `#${shortId(s.id)}` : "";
    const metaParts: MetaPart[] = [];
    if (showModel) metaParts.push({ text: s.model as string, color: "gray" });
    if (showBranch) metaParts.push({ text: s.branch as string, color: "cyan" });
    metaParts.push({ text: age, color: "dim" });
    plainBracket = `[${metaParts.map((p) => p.text).join(" · ")}]`;
    paintedBracket = `[${metaParts.map((p) => paint(p.text, p.color, color)).join(" · ")}]`;

    const idCost = idText ? 1 + displayWidth(idText) : 0;
    const bracketCost = 2 + displayWidth(plainBracket);
    contentBudget = width - 5 - idCost - bracketCost - labelReserve;
    if (contentBudget >= MIN_NAME || !(showModel || showBranch || showId)) break;
    if (showModel) showModel = false;
    else if (showBranch) showBranch = false;
    else showId = false;
  }
  // ponytail: an extreme outlier name/cwd/label value could in theory still
  // overflow — real ones are bounded, and truncEnd/truncTail floor at "…".
  contentBudget = Math.max(1, contentBudget);

  const name = truncEnd(s.name, contentBudget);
  let cwd = "";
  if (showCwd) {
    const cwdBudget = contentBudget - displayWidth(name) - 2;
    if (cwdBudget > 0) cwd = truncTail(s.cwd, cwdBudget);
  }

  // A pinned row swaps the 2-space indent for 📌 (same 2-col width), so the
  // "- 5" budget above holds either way — see the PIN_MARK comment.
  const prefix = s.pinned ? PIN_MARK : "  ";
  const plainLine = `${prefix}${icon} ${name}${idText ? ` ${idText}` : ""}${cwd ? `  ${cwd}` : ""}  ${plainBracket}`;
  const paintedLine = `${prefix}${icon} ${paint(name, "bold", color)}${idText ? ` ${paint(idText, "dim", color)}` : ""}${cwd ? `  ${paint(cwd, "dim", color)}` : ""}  ${paintedBracket}`;

  if (!blockedLabel) return [paintedLine];

  if (inlineLabel) {
    const remaining = width - displayWidth(plainLine) - 3; // 3 = " — "
    if (remaining >= 1) {
      return [`${paintedLine} — ${truncEnd(blockedLabel, remaining)}`]; // keep the head; see blockedContinuationLine
    }
  }
  return [paintedLine, blockedContinuationLine(blockedLabel, width)];
}

/** Header: full counts phrase when there's room, else compact colored chips. */
function renderHeader(vm: ViewModel, color: boolean, width: number): string {
  const c = vm.counts;
  if (width >= 60) {
    const full = `pi-presence · ${c.needsYou} need you · ${c.running} running · ${c.idle} idle · ${c.dormant} dormant`;
    return paint(truncEnd(full, width), "bold", color);
  }
  // Chips in priority order (needs-you first, never dropped); measure/drop on
  // plain text, color only the survivors (same "truncate before color" rule
  // as renderSessionLine).
  const chips: MetaPart[] = [];
  if (c.needsYou > 0) chips.push({ text: `⛔${c.needsYou}`, color: GROUP_COLOR["needs-you"] });
  if (c.running > 0) chips.push({ text: `⚡${c.running}`, color: GROUP_COLOR.running });
  if (c.idle > 0) chips.push({ text: `✓${c.idle}`, color: GROUP_COLOR.idle });
  if (c.dormant > 0) chips.push({ text: `💤${c.dormant}`, color: GROUP_COLOR.dormant });

  // Drop lowest-priority first (dormant, then idle, then running) — i.e. pop
  // the tail — until the joined line fits; needs-you (index 0) never drops.
  while (chips.length > 1 && displayWidth(chips.map((p) => p.text).join(" ")) > width) {
    chips.pop();
  }
  if (chips.length === 0) return paint("pi-presence", "bold", color);
  return chips.map((p) => paint(p.text, p.color, color)).join(" ");
}

/** Render the whole view model into lines. */
export function renderView(vm: ViewModel, opts: RenderOptions = {}): string[] {
  const color = opts.color ?? false;
  const width = Math.max(opts.width ?? 80, 20);
  const lines: string[] = [renderHeader(vm, color, width), ""];

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
    for (const s of list) lines.push(...renderSessionLine(s, opts));
    lines.push("");
  }

  if (!any) lines.push(paint("  no pi sessions", "dim", color));
  return lines;
}
