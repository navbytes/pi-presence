import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSelfStartTime } from "./liveness.js";
import type { SessionSnapshot } from "./reconcile.js";
import { SCHEMA_VERSION, type StateFile } from "./schema.js";
import { watchLive } from "./watch.js";

function writeStateFile(dir: string, id: string, state: StateFile["state"]) {
  const file: StateFile = {
    schema: SCHEMA_VERSION,
    sessionId: id,
    sessionFile: null,
    sessionName: id,
    state,
    blockedLabel: null,
    cwd: "/tmp/proj",
    branch: null,
    model: null,
    pid: process.pid, // alive: this test process
    startTime: readSelfStartTime(),
    bootId: null,
    nonce: "n",
    updatedAt: Date.now(),
    terminal: {},
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(file));
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("watchLive", () => {
  let dir: string;
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-presence-watch-"));
  });

  afterEach(() => {
    for (const d of disposers.splice(0)) d();
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits an initial snapshot synchronously and picks up new files", async () => {
    writeStateFile(dir, "first", "working");

    let latest: SessionSnapshot[] = [];
    let calls = 0;
    const dispose = watchLive(
      dir,
      (snaps) => {
        latest = snaps;
        calls++;
      },
      { debounceMs: 10, reconcileIntervalMs: 40 },
    );
    disposers.push(dispose);

    // initial scan is synchronous
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(latest.map((s) => s.file.sessionId)).toContain("first");
    expect(latest.find((s) => s.file.sessionId === "first")?.liveState).toBe("working");

    // add a second file; the watcher or the interval reconcile should catch it
    writeStateFile(dir, "second", "blocked");
    await waitFor(() => latest.some((s) => s.file.sessionId === "second"));
    expect(latest.find((s) => s.file.sessionId === "second")?.liveState).toBe("blocked");
  });

  it("stops emitting after dispose", async () => {
    let calls = 0;
    const dispose = watchLive(dir, () => calls++, { debounceMs: 5, reconcileIntervalMs: 20 });
    await waitFor(() => calls >= 1);
    dispose();
    const snapshot = calls;
    writeStateFile(dir, "late", "idle");
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toBe(snapshot);
  });
});
