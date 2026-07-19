import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type StateFile } from "./schema.js";
import { type SessionIdentity, buildStateFile, unlinkState, writeState } from "./state-writer.js";

const identity: SessionIdentity = {
  sessionId: "abc",
  sessionFile: "/x/abc.jsonl",
  sessionName: "task",
  cwd: "/home/u/p",
  branch: "main",
  model: "m",
  pid: 5,
  startTime: 100,
  bootId: null,
  nonce: "nn",
  terminal: { program: "iTerm.app", titleMarker: "⚡ task · working" },
};

describe("buildStateFile", () => {
  it("stamps schema, state, and updatedAt", () => {
    const f = buildStateFile(identity, "working", null, 12345);
    expect(f.schema).toBe(SCHEMA_VERSION);
    expect(f.state).toBe("working");
    expect(f.updatedAt).toBe(12345);
    expect(f.blockedLabel).toBeNull();
    expect(f.terminal.titleMarker).toBe("⚡ task · working");
  });

  it("keeps blockedLabel only for the blocked state", () => {
    expect(buildStateFile(identity, "blocked", "Allow?", 1).blockedLabel).toBe("Allow?");
    expect(buildStateFile(identity, "idle", "Allow?", 1).blockedLabel).toBeNull();
  });
});

describe("writeState / unlinkState", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-presence-sw-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a state file named by session id", () => {
    const f = buildStateFile(identity, "idle", null, 1) as StateFile;
    writeState(dir, f);
    const path = join(dir, "abc.json");
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).sessionId).toBe("abc");
  });

  it("unlinks the file and tolerates a missing file", () => {
    const f = buildStateFile(identity, "idle", null, 1) as StateFile;
    writeState(dir, f);
    unlinkState(dir, "abc");
    expect(existsSync(join(dir, "abc.json"))).toBe(false);
    expect(() => unlinkState(dir, "abc")).not.toThrow();
  });
});
