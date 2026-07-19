import { describe, expect, it } from "vitest";
import { captureTerminal } from "./terminal.js";

describe("captureTerminal", () => {
  it("captures the iTerm2 environment", () => {
    const t = captureTerminal({
      TERM_PROGRAM: "iTerm.app",
      ITERM_SESSION_ID: "w0t1p0:UUID",
      WINDOWID: "12345",
    });
    expect(t.program).toBe("iTerm.app");
    expect(t.itermSessionId).toBe("w0t1p0:UUID");
    expect(t.windowId).toBe("12345");
    expect(t.tmuxPane).toBeNull();
    expect(t.titleMarker).toBeNull();
  });

  it("falls back from GHOSTTY_RESOURCES_DIR to GHOSTTY_BIN_DIR", () => {
    expect(captureTerminal({ GHOSTTY_BIN_DIR: "/opt/ghostty/bin" }).ghosttyResource).toBe(
      "/opt/ghostty/bin",
    );
    expect(captureTerminal({ GHOSTTY_RESOURCES_DIR: "/r" }).ghosttyResource).toBe("/r");
  });

  it("captures tmux context", () => {
    const t = captureTerminal({ TMUX: "/tmp/tmux-1000/default,1,0", TMUX_PANE: "%3" });
    expect(t.tmux).toContain("tmux");
    expect(t.tmuxPane).toBe("%3");
  });

  it("returns nulls for an empty environment", () => {
    const t = captureTerminal({});
    expect(t).toEqual({
      program: null,
      itermSessionId: null,
      termSessionId: null,
      ghosttyResource: null,
      windowId: null,
      tmux: null,
      tmuxPane: null,
      titleMarker: null,
    });
  });

  it("treats empty-string env values as unset", () => {
    expect(captureTerminal({ TERM_PROGRAM: "" }).program).toBeNull();
  });
});
