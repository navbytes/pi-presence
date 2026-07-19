import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, isReadableSchema, isSessionState, normalizeState } from "./schema.js";

describe("schema guards", () => {
  it("recognizes writer states", () => {
    expect(isSessionState("working")).toBe(true);
    expect(isSessionState("blocked")).toBe(true);
    expect(isSessionState("idle")).toBe(true);
  });

  it("rejects non-writer / bogus states", () => {
    expect(isSessionState("dormant")).toBe(false); // reader-derived, never written
    expect(isSessionState("nonsense")).toBe(false);
    expect(isSessionState(42)).toBe(false);
    expect(isSessionState(undefined)).toBe(false);
  });

  it("normalizes unknown states to idle (forward-compat)", () => {
    expect(normalizeState("working")).toBe("working");
    expect(normalizeState("blocked")).toBe("blocked");
    expect(normalizeState("future-state")).toBe("idle");
    expect(normalizeState(null)).toBe("idle");
  });

  it("accepts current/older schema versions and rejects newer", () => {
    expect(isReadableSchema(SCHEMA_VERSION)).toBe(true);
    expect(isReadableSchema(SCHEMA_VERSION - 1)).toBe(true);
    expect(isReadableSchema(SCHEMA_VERSION + 1)).toBe(false);
    expect(isReadableSchema("1")).toBe(false);
    expect(isReadableSchema(Number.NaN)).toBe(false);
  });
});
