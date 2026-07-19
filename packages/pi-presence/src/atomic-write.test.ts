import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteJson } from "./atomic-write.js";

describe("atomicWriteJson", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-presence-atomic-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes valid JSON to the target", () => {
    const target = join(dir, "s1.json");
    atomicWriteJson(target, { a: 1, b: "x" }, "nonce");
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ a: 1, b: "x" });
  });

  it("leaves no temp files behind", () => {
    const target = join(dir, "s1.json");
    atomicWriteJson(target, { a: 1 }, "nonce");
    const leftover = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftover).toHaveLength(0);
  });

  it("overwrites atomically on repeated writes", () => {
    const target = join(dir, "s1.json");
    atomicWriteJson(target, { v: 1 }, "n");
    atomicWriteJson(target, { v: 2 }, "n");
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ v: 2 });
    expect(readdirSync(dir)).toEqual(["s1.json"]);
  });

  it("creates the directory if missing", () => {
    const target = join(dir, "nested", "deep", "s1.json");
    atomicWriteJson(target, { ok: true }, "n");
    expect(existsSync(target)).toBe(true);
  });
});
