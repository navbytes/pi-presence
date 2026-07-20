import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real pi 0.79.2 exports getAgentDir but NOT CONFIG_DIR_NAME (see
// handoffs/research-pi-api.md, handoffs/defects-wave1.md D1). Each test mocks
// a progressively more stripped-down export surface via vi.doMock + a dynamic
// import (module registry reset between tests) so we can vary the mock per
// test without the whole-file hoisting a single vi.mock implies.
describe("pi-agent-dir (0.79.2 export-surface resilience)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@earendil-works/pi-coding-agent");
    Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
  });

  it('falls back to ".pi" when CONFIG_DIR_NAME is absent (the real 0.79.2 shape)', async () => {
    // Vitest's mock proxy throws on a truly-omitted key (unlike jiti, which
    // resolves a missing named export to `undefined`); declaring it
    // `undefined` explicitly reproduces the same observable value.
    vi.doMock("@earendil-works/pi-coding-agent", () => ({
      getAgentDir: () => "/agent",
      CONFIG_DIR_NAME: undefined,
    }));
    const { configDirName, resolveAgentDir } = await import("./pi-agent-dir.js");
    expect(configDirName()).toBe(".pi");
    expect(resolveAgentDir()).toBe("/agent"); // getAgentDir IS present on 0.79.2 — used directly
  });

  it("falls back to PI_CODING_AGENT_DIR when getAgentDir is also unavailable", async () => {
    vi.doMock("@earendil-works/pi-coding-agent", () => ({
      getAgentDir: undefined,
      CONFIG_DIR_NAME: undefined,
    }));
    process.env.PI_CODING_AGENT_DIR = "/env-agent-dir";
    const { resolveAgentDir } = await import("./pi-agent-dir.js");
    expect(resolveAgentDir()).toBe("/env-agent-dir");
  });

  it("falls back to ~/<configDirName>/agent as a last resort", async () => {
    vi.doMock("@earendil-works/pi-coding-agent", () => ({
      getAgentDir: undefined,
      CONFIG_DIR_NAME: undefined,
    }));
    Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
    const { resolveAgentDir } = await import("./pi-agent-dir.js");
    expect(resolveAgentDir()).toBe(join(homedir(), ".pi", "agent"));
  });
});
