import type { SessionState } from "./schema.js";

// ---------------------------------------------------------------------------
// Terminal-title emission.
//
// Writing raw OSC to stdout while the TUI renders is the community pattern for
// self-labeling tabs, but it is fragile (pi #2388: OSC writes can corrupt RPC
// JSONL; oh-my-pi #658: no guarantee of surviving a full repaint). Callers MUST
// guard emission on `ctx.mode === "tui"` && `process.stdout.isTTY`.
//
// The title is an INJECTION SURFACE: session names, cwd, and branch can contain
// arbitrary bytes. `sanitizeTitle` strips escape sequences and control chars and
// caps the length before anything reaches the terminal. Patterns are built with
// the RegExp constructor + \x escapes so no literal control bytes live in source.
// ---------------------------------------------------------------------------

/** Max rendered title length (characters) before truncation. */
export const MAX_TITLE_LENGTH = 160;

/** Glyph shown per writer-emitted state. */
export const STATE_ICON: Record<SessionState, string> = {
  working: "⚡", // ⚡
  blocked: "⛔", // ⛔
  idle: "✓", // ✓
};

const ESC = "\x1b";
const BEL = "\x07";

// Full OSC sequence: ESC ] ... terminated by BEL, ST (ESC \), or end-of-string.
const OSC_SEQUENCE = /\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g;
// CSI sequence: ESC [ params intermediates final.
const CSI_SEQUENCE = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
// Other ESC Fe sequences: ESC + single byte in @-_.
const ESC_FE = /\x1b[@-Z\\-_]/g;
// Any remaining C0/C1 control chars.
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * Strip escape/control sequences from a candidate title and enforce a max
 * length. Order matters: remove full OSC/CSI/ESC sequences first, then collapse
 * any lingering control bytes to spaces.
 */
export function sanitizeTitle(input: string): string {
  let out = input
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESC_FE, "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > MAX_TITLE_LENGTH) {
    out = `${out.slice(0, MAX_TITLE_LENGTH - 1)}…`; // …
  }
  return out;
}

/** Values available to a title format string. */
export interface TitleInfo {
  name: string;
  state: SessionState;
  icon: string;
  cwd: string;
  branch: string | null;
}

/**
 * Render and sanitize a title from a format string. Supported placeholders:
 * `{icon}` `{name}` `{state}` `{cwd}` `{branch}`.
 */
export function formatTitle(format: string, info: TitleInfo): string {
  const replaced = format
    .replace(/\{icon\}/g, info.icon)
    .replace(/\{name\}/g, info.name)
    .replace(/\{state\}/g, info.state)
    .replace(/\{cwd\}/g, info.cwd)
    .replace(/\{branch\}/g, info.branch ?? "");
  return sanitizeTitle(replaced);
}

/** Build the raw OSC 0 + OSC 2 escape string that sets the tab/window title. */
export function buildTitleEscape(title: string): string {
  const safe = sanitizeTitle(title);
  // OSC 0 sets icon + window title; OSC 2 sets window title. Emit both so tabs
  // update regardless of which sequence the terminal honors.
  return `${ESC}]0;${safe}${BEL}${ESC}]2;${safe}${BEL}`;
}

/**
 * Write a title to a stream (defaults to stdout). Safe to call unguarded; the
 * guard on TUI/TTY belongs to the caller. Never throws.
 */
export function writeTitle(title: string, out: NodeJS.WriteStream = process.stdout): void {
  try {
    out.write(buildTitleEscape(title));
  } catch {
    // A broken pipe / closed stream must never crash the agent.
  }
}
