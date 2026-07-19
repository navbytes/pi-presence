import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGitBranch } from "./git.js";

describe("readGitBranch", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-presence-git-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a branch from .git/HEAD", () => {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/feature/x\n");
    expect(readGitBranch(dir)).toBe("feature/x");
  });

  it("returns a short sha for detached HEAD", () => {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    expect(readGitBranch(dir)).toBe("0123456789ab");
  });

  it("resolves a worktree .git file", () => {
    const realGit = join(dir, "realgit");
    mkdirSync(realGit);
    writeFileSync(join(realGit, "HEAD"), "ref: refs/heads/wt\n");
    writeFileSync(join(dir, ".git"), `gitdir: ${realGit}\n`);
    expect(readGitBranch(dir)).toBe("wt");
  });

  it("returns null when there is no git dir", () => {
    expect(readGitBranch(dir)).toBeNull();
  });
});
