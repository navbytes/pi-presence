import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PINS_CAP,
  type PinEntry,
  addPin,
  parsePinsFile,
  pinMatches,
  readPinsFile,
  removePin,
  toPinEntry,
} from "./pins.js";

function entry(overrides: Partial<PinEntry> = {}): PinEntry {
  return {
    sessionFile: "/x/a.jsonl",
    sessionId: "a",
    cwd: "/home/u/a",
    name: "a",
    pinnedAt: 1,
    ...overrides,
  };
}

describe("parsePinsFile", () => {
  it("parses a valid file", () => {
    const pf = parsePinsFile(JSON.stringify({ version: 1, pins: [entry()] }));
    expect(pf.pins).toHaveLength(1);
    expect(pf.pins[0]).toMatchObject({ sessionId: "a" });
  });

  it("treats invalid JSON as empty, never throws", () => {
    expect(parsePinsFile("{not json")).toEqual({ version: 1, pins: [] });
  });

  it("treats a missing/wrong-shaped pins array as empty", () => {
    expect(parsePinsFile(JSON.stringify({ version: 1 }))).toEqual({ version: 1, pins: [] });
    expect(parsePinsFile("null")).toEqual({ version: 1, pins: [] });
    expect(parsePinsFile("[]")).toEqual({ version: 1, pins: [] });
  });

  it("drops malformed entries but keeps valid ones alongside them", () => {
    const pf = parsePinsFile(
      JSON.stringify({
        version: 1,
        pins: [entry({ sessionId: "good" }), { sessionId: 42 }, "nope", null],
      }),
    );
    expect(pf.pins.map((p) => p.sessionId)).toEqual(["good"]);
  });

  it("preserves unknown fields on an otherwise-valid entry (forward-compat round trip)", () => {
    const raw = { ...entry(), futureField: "keep-me" };
    const pf = parsePinsFile(JSON.stringify({ version: 1, pins: [raw] }));
    expect((pf.pins[0] as unknown as Record<string, unknown>).futureField).toBe("keep-me");
  });
});

describe("pinMatches", () => {
  it("matches by sessionFile when the pin has one, even if sessionId churned", () => {
    const p = entry({ sessionFile: "/x/a.jsonl", sessionId: "old" });
    expect(pinMatches(p, { sessionFile: "/x/a.jsonl", sessionId: "new" })).toBe(true);
    expect(pinMatches(p, { sessionFile: "/x/b.jsonl", sessionId: "old" })).toBe(false);
  });

  it("falls back to sessionId only for pins with no sessionFile", () => {
    const p = entry({ sessionFile: null, sessionId: "a" });
    expect(pinMatches(p, { sessionFile: null, sessionId: "a" })).toBe(true);
    expect(pinMatches(p, { sessionFile: "/anything", sessionId: "b" })).toBe(false);
  });
});

describe("toPinEntry", () => {
  it("builds an entry from a session-shaped value", () => {
    const e = toPinEntry({ sessionFile: "/x/a.jsonl", id: "a", cwd: "/home/u/a", name: "A" }, 123);
    expect(e).toEqual({
      sessionFile: "/x/a.jsonl",
      sessionId: "a",
      cwd: "/home/u/a",
      name: "A",
      pinnedAt: 123,
    });
  });
});

describe("pin store round-trip (real disk)", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-presence-pins-"));
    path = join(dir, "presence-pins.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // AC11: pins persist across a process restart — plain JSON on disk, no in-memory-only state.
  it("AC11: a fresh readPinsFile call (simulating a restart) sees what addPin wrote", () => {
    expect(addPin(path, entry())).toEqual({ ok: true });
    expect(existsSync(path)).toBe(true);
    expect(readPinsFile(path).pins).toHaveLength(1);
    expect(JSON.parse(readFileSync(path, "utf8")).pins).toHaveLength(1);
  });

  // AC3 (absent) + corrupt-file requirement: both degrade to empty, never crash a reader.
  it("an absent file reads as empty, never crashes", () => {
    expect(readPinsFile(join(dir, "nope.json"))).toEqual({ version: 1, pins: [] });
  });

  it("a corrupt file reads as empty, never crashes", () => {
    writeFileSync(path, "{ not json", "utf8");
    expect(readPinsFile(path)).toEqual({ version: 1, pins: [] });
  });

  it("leaves no temp files behind after a write", () => {
    addPin(path, entry());
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("pinning the same session twice is idempotent (no duplicate entry)", () => {
    addPin(path, entry());
    addPin(path, entry({ pinnedAt: 999 }));
    expect(readPinsFile(path).pins).toHaveLength(1);
  });

  it("unpinning removes only the matching entry", () => {
    addPin(path, entry({ sessionId: "a", sessionFile: "/x/a.jsonl" }));
    addPin(path, entry({ sessionId: "b", sessionFile: null }));
    expect(removePin(path, { sessionFile: "/x/a.jsonl", sessionId: "a" })).toEqual({ ok: true });
    expect(readPinsFile(path).pins.map((p) => p.sessionId)).toEqual(["b"]);
  });

  // Requirement: "Unpin of a ghost pin removes the pin entry" — removePin only needs the
  // identity fields (sessionFile/sessionId), which a ghost row still carries.
  it("unpinning a ghost (ID-only, no live session) still removes the entry", () => {
    addPin(path, entry({ sessionId: "ghost", sessionFile: null }));
    expect(removePin(path, { sessionFile: null, sessionId: "ghost" })).toEqual({ ok: true });
    expect(readPinsFile(path).pins).toHaveLength(0);
  });

  it("unpinning something that was never pinned is a harmless no-op", () => {
    addPin(path, entry({ sessionId: "a" }));
    expect(removePin(path, { sessionFile: null, sessionId: "not-pinned" })).toEqual({ ok: true });
    expect(readPinsFile(path).pins).toHaveLength(1);
  });

  // AC9: a 21st pin attempt fails with a clear error; the existing 20 are unchanged.
  it("AC9: a 21st pin fails loudly and leaves the existing 20 unchanged", () => {
    for (let i = 0; i < PINS_CAP; i++) {
      expect(addPin(path, entry({ sessionId: `s${i}`, sessionFile: null }))).toEqual({ ok: true });
    }
    const before = readPinsFile(path);
    expect(before.pins).toHaveLength(PINS_CAP);

    const result = addPin(path, entry({ sessionId: "overflow", sessionFile: null }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("20") });
    expect(readPinsFile(path)).toEqual(before); // no side effect
  });

  it("re-pinning an already-pinned session succeeds even when at the cap", () => {
    for (let i = 0; i < PINS_CAP; i++) {
      addPin(path, entry({ sessionId: `s${i}`, sessionFile: null }));
    }
    expect(addPin(path, entry({ sessionId: "s0", sessionFile: null }))).toEqual({ ok: true });
    expect(readPinsFile(path).pins).toHaveLength(PINS_CAP);
  });
});
