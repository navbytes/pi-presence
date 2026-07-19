import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, resolveSettings } from "./settings.js";

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
