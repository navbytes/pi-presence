import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandTilde, getAgentDir, getLiveDir, stateFilePath } from "./paths.js";

describe("path resolution", () => {
  it("expands tilde", () => {
    expect(expandTilde("~")).toBe(homedir());
    expect(expandTilde("~/foo/bar")).toBe(join(homedir(), "foo/bar"));
    expect(expandTilde("/abs/path")).toBe("/abs/path");
    expect(expandTilde("relative")).toBe("relative");
  });

  it("defaults agent dir to ~/.pi/agent", () => {
    expect(getAgentDir({})).toBe(join(homedir(), ".pi", "agent"));
  });

  it("honors PI_CODING_AGENT_DIR (with tilde)", () => {
    expect(getAgentDir({ PI_CODING_AGENT_DIR: "/custom/agent" })).toBe("/custom/agent");
    expect(getAgentDir({ PI_CODING_AGENT_DIR: "~/xyz" })).toBe(join(homedir(), "xyz"));
  });

  it("live dir is agent/live by default, overridable", () => {
    expect(getLiveDir({})).toBe(join(homedir(), ".pi", "agent", "live"));
    expect(getLiveDir({ PI_CODING_AGENT_DIR: "/a" })).toBe(join("/a", "live"));
    expect(getLiveDir({ PI_PRESENCE_LIVE_DIR: "/override/live" })).toBe("/override/live");
  });

  it("PI_PRESENCE_LIVE_DIR wins over PI_CODING_AGENT_DIR", () => {
    expect(getLiveDir({ PI_PRESENCE_LIVE_DIR: "/x", PI_CODING_AGENT_DIR: "/y" })).toBe("/x");
  });

  it("builds state file paths", () => {
    expect(stateFilePath("abc123", "/live")).toBe(join("/live", "abc123.json"));
  });
});
