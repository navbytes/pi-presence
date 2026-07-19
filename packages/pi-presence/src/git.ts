import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Best-effort current git branch for `cwd`, read straight from `.git/HEAD`
 * (no subprocess). Handles worktrees (where `.git` is a file pointing at the
 * real gitdir) and detached HEAD (returns a short sha). Returns null on any
 * problem — branch is purely decorative in the state file.
 */
export function readGitBranch(cwd: string): string | null {
  try {
    let head: string;
    try {
      head = readFileSync(join(cwd, ".git", "HEAD"), "utf8");
    } catch {
      const dotGit = readFileSync(join(cwd, ".git"), "utf8").trim();
      const m = /^gitdir:\s*(.+)$/.exec(dotGit);
      if (!m) return null;
      head = readFileSync(join(m[1] as string, "HEAD"), "utf8");
    }
    const trimmed = head.trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(trimmed);
    if (ref) return ref[1] as string;
    return trimmed ? trimmed.slice(0, 12) : null;
  } catch {
    return null;
  }
}
