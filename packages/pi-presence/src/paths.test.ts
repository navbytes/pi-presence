import { afterEach, describe, expect, it, vi } from "vitest";

// paths.ts's only pi-package dependency is getAgentDir (present on real pi
// 0.79.2, unlike CONFIG_DIR_NAME — see defects-wave1.md D1). Exercise both the
// normal path and the resilience fallback; pi-agent-dir.test.ts covers the
// fallback chain itself (env var, homedir) in full.
describe("getLiveDir / stateFilePath", () => {
  const savedEnv = process.env.PI_CODING_AGENT_DIR;
  afterEach(() => {
    vi.doUnmock("@earendil-works/pi-coding-agent");
    if (savedEnv === undefined) Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
    else process.env.PI_CODING_AGENT_DIR = savedEnv;
  });

  it("appends live/<id>.json under pi's real getAgentDir()", async () => {
    vi.resetModules();
    vi.doMock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => "/agent" }));
    const { getLiveDir, stateFilePath } = await import("./paths.js");
    expect(getLiveDir()).toBe("/agent/live");
    expect(stateFilePath("sess-1")).toBe("/agent/live/sess-1.json");
  });

  it("still resolves (never throws) when getAgentDir is missing from the export surface", async () => {
    vi.resetModules();
    Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
    vi.doMock("@earendil-works/pi-coding-agent", () => ({
      getAgentDir: undefined,
      CONFIG_DIR_NAME: undefined,
    }));
    const { getLiveDir } = await import("./paths.js");
    expect(getLiveDir().endsWith("live")).toBe(true);
  });
});
