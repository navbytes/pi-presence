import type { TerminalInfo } from "./schema.js";

// ---------------------------------------------------------------------------
// One-time terminal-correlation snapshot, captured at session start from the pi
// process's environment. Readers use these to focus the originating tab.
// ---------------------------------------------------------------------------

/** Capture the terminal-correlation env into a {@link TerminalInfo}. */
export function captureTerminal(env: NodeJS.ProcessEnv = process.env): TerminalInfo {
  const get = (key: string): string | null => {
    const v = env[key];
    return v && v.length > 0 ? v : null;
  };
  return {
    program: get("TERM_PROGRAM"),
    itermSessionId: get("ITERM_SESSION_ID"),
    termSessionId: get("TERM_SESSION_ID"),
    ghosttyResource: get("GHOSTTY_RESOURCES_DIR") ?? get("GHOSTTY_BIN_DIR"),
    windowId: get("WINDOWID"),
    tmux: get("TMUX"),
    tmuxPane: get("TMUX_PANE"),
    titleMarker: null,
  };
}
