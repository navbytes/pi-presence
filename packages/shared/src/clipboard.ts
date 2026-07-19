import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Cross-platform clipboard copy, used as the focus fallback ("copy the resume
// command"). macOS → pbcopy, Windows → clip, Linux → wl-copy | xclip | xsel
// (tried in order). Command selection is pure/testable; execution is injectable.
// ---------------------------------------------------------------------------

export interface ClipboardCommand {
  file: string;
  args: string[];
}

/** Ordered clipboard command candidates for a platform (first that works wins). */
export function clipboardCandidates(
  platform: NodeJS.Platform = process.platform,
): ClipboardCommand[] {
  switch (platform) {
    case "darwin":
      return [{ file: "pbcopy", args: [] }];
    case "win32":
      return [{ file: "clip", args: [] }];
    case "linux":
      return [
        { file: "wl-copy", args: [] },
        { file: "xclip", args: ["-selection", "clipboard"] },
        { file: "xsel", args: ["--clipboard", "--input"] },
      ];
    default:
      return [];
  }
}

export interface ClipboardDeps {
  run?: (cmd: ClipboardCommand, input: string) => void;
  platform?: NodeJS.Platform;
}

function defaultRun(cmd: ClipboardCommand, input: string): void {
  execFileSync(cmd.file, cmd.args, {
    input,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 3000,
  });
}

/** Copy text to the clipboard. Returns whether a copier succeeded. Never throws. */
export function copyToClipboard(text: string, deps: ClipboardDeps = {}): boolean {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  for (const cmd of clipboardCandidates(platform)) {
    try {
      run(cmd, text);
      return true;
    } catch {
      // try the next candidate
    }
  }
  return false;
}
