import { describe, expect, it } from "vitest";
import { parseDuration } from "./duration.js";

describe("parseDuration", () => {
  it("parses a bare number as seconds", () => {
    expect(parseDuration("90")).toBe(90_000);
  });

  it("parses each unit suffix", () => {
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("2h")).toBe(2 * 3_600_000);
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  it("rejects zero, negative, and non-numeric input", () => {
    expect(parseDuration("0")).toBeUndefined();
    expect(parseDuration("0s")).toBeUndefined();
    expect(parseDuration("-5m")).toBeUndefined();
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("abc")).toBeUndefined();
  });

  it("rejects unknown units and malformed strings", () => {
    expect(parseDuration("5w")).toBeUndefined();
    expect(parseDuration("5 m")).toBeUndefined();
    expect(parseDuration("5.5h")).toBeUndefined();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDuration("  90s  ")).toBe(90_000);
  });
});
