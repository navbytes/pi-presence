import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pi 0.79.2's real dist/index.js exports getAgentDir but not CONFIG_DIR_NAME
// (see handoffs/research-pi-api.md, handoffs/defects-wave1.md D1). A plain
// named import of it used to silently bind `undefined` and crash
// join(cwd, undefined, "settings.json"). Reproduce that exact export surface
// so loadSettings's fallback is proven, not just asserted by inspection.
const hoisted = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => hoisted.agentDir,
  CONFIG_DIR_NAME: undefined, // absent at runtime on 0.79.2; explicit so the mock proxy allows the read
}));

import { DEFAULT_SETTINGS, loadSettings, parseSettings, resolveSettings } from "./settings.js";

describe("parseSettings", () => {
  it("returns defaults when the block is absent", () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ other: 1 })).toEqual(DEFAULT_SETTINGS);
  });

  it("merges provided values over defaults", () => {
    const s = parseSettings({
      "pi-presence": {
        enabled: false,
        title: false,
        titleFormat: "{name}",
        notify: true,
        idleDebounceMs: 500,
        retryGraceMs: 1000,
        notifyThresholdMs: 3000,
      },
    });
    expect(s).toEqual({
      enabled: false,
      title: false,
      titleFormat: "{name}",
      notify: true,
      idleDebounceMs: 500,
      retryGraceMs: 1000,
      notifyThresholdMs: 3000,
    });
  });

  it("ignores invalid types and keeps defaults", () => {
    const s = parseSettings({
      "pi-presence": {
        enabled: "yes",
        idleDebounceMs: -5,
        titleFormat: "",
        notifyThresholdMs: "big",
      },
    });
    expect(s.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(s.idleDebounceMs).toBe(DEFAULT_SETTINGS.idleDebounceMs);
    expect(s.titleFormat).toBe(DEFAULT_SETTINGS.titleFormat);
    expect(s.notifyThresholdMs).toBe(DEFAULT_SETTINGS.notifyThresholdMs);
  });

  it("rounds fractional millisecond values", () => {
    expect(parseSettings({ "pi-presence": { idleDebounceMs: 249.7 } }).idleDebounceMs).toBe(250);
  });
});

describe("resolveSettings (project over global)", () => {
  it("lets the project block override the global block per key", () => {
    const { settings } = resolveSettings(
      { "pi-presence": { notify: true, idleDebounceMs: 500 } },
      { "pi-presence": { idleDebounceMs: 100 } },
    );
    expect(settings.notify).toBe(true); // from global, untouched
    expect(settings.idleDebounceMs).toBe(100); // project wins
  });

  it("returns no warnings for valid input", () => {
    const { warnings } = resolveSettings({ "pi-presence": { enabled: false } }, undefined);
    expect(warnings).toEqual([]);
  });

  it("warns on mistyped keys instead of silently ignoring them", () => {
    const { settings, warnings } = resolveSettings(
      { "pi-presence": { enabled: "false", idleDebounceMs: "soon" } },
      undefined,
    );
    // still falls back to defaults...
    expect(settings.enabled).toBe(true);
    expect(settings.idleDebounceMs).toBe(DEFAULT_SETTINGS.idleDebounceMs);
    // ...but now surfaces the problem
    expect(warnings.some((w) => w.includes("enabled"))).toBe(true);
    expect(warnings.some((w) => w.includes("idleDebounceMs"))).toBe(true);
  });
});

describe("loadSettings against pi 0.79.2's real export surface (no CONFIG_DIR_NAME)", () => {
  let agentDir: string;
  let projectDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-presence-agent-"));
    projectDir = mkdtempSync(join(tmpdir(), "pi-presence-proj-"));
    hoisted.agentDir = agentDir;
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("does not throw and still reads <cwd>/.pi/settings.json (the historical crash repro)", () => {
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(
      join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ "pi-presence": { notify: true } }),
    );
    const { settings, warnings } = loadSettings({ cwd: projectDir });
    expect(warnings).toEqual([]);
    expect(settings.notify).toBe(true); // proves the project block was actually read
  });

  it("falls back to defaults when there is no settings.json anywhere", () => {
    const { settings, warnings } = loadSettings({ cwd: projectDir });
    expect(warnings).toEqual([]);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});
