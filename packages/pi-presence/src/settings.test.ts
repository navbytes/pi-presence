import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings.js";

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
