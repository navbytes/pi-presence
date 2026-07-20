import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateFile } from "../src/schema.js";

// Mock ONLY the runtime value the extension imports from pi (`getAgentDir`), so
// the test drives the real wiring without loading pi's heavy runtime.
const hoisted = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => hoisted.agentDir,
  CONFIG_DIR_NAME: ".pi",
}));

import piPresence from "./index.js";

// Real pi 0.79.2 extension event names (ExtensionAPI.on() overloads), copied
// from handoffs/research-pi-api.md §C (verified against the real, installed
// types.d.ts). `agent_settled` and `session_info_changed` are deliberately
// absent: neither is a real extension event — see defects-wave1.md D2/D8.
const REAL_PI_EVENT_NAMES = new Set([
  "project_trust",
  "resources_discover",
  "session_start",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_compact",
  "session_shutdown",
  "session_before_tree",
  "session_tree",
  "context",
  "before_provider_request",
  "after_provider_response",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "model_select",
  "thinking_level_select",
  "tool_call",
  "tool_result",
  "user_bash",
  "input",
]);

type Handler = (event: unknown, ctx: unknown) => unknown;

function makeApi() {
  const handlers = new Map<string, Handler>();
  const bus = new Map<string, Array<(d: unknown) => void>>();
  const api = {
    on: (evt: string, h: Handler) => handlers.set(evt, h),
    events: {
      emit: (ch: string, d: unknown) => {
        for (const h of bus.get(ch) ?? []) h(d);
      },
      on: (ch: string, h: (d: unknown) => void) => {
        const arr = bus.get(ch) ?? [];
        arr.push(h);
        bus.set(ch, arr);
        return () => {};
      },
    },
    getSessionName: () => "demo",
  };
  return { api, handlers };
}

function makeCtx(idle = true) {
  return {
    mode: "json",
    hasUI: false,
    cwd: "/home/u/proj",
    sessionManager: {
      getSessionId: () => "sess-x",
      getSessionFile: () => "/x/sess-x.jsonl",
    },
    model: { id: "anthropic/claude" },
    isIdle: () => idle,
    isProjectTrusted: () => true,
    ui: { setTitle: () => {} },
  };
}

function readState(): StateFile {
  const path = join(hoisted.agentDir, "live", "sess-x.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("pi-presence extension wiring", () => {
  beforeEach(() => {
    hoisted.agentDir = mkdtempSync(join(tmpdir(), "pi-presence-ext-"));
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(hoisted.agentDir, { recursive: true, force: true });
  });

  it("writes the live file and drives the full lifecycle", () => {
    const { api, handlers } = makeApi();
    piPresence(api as unknown as Parameters<typeof piPresence>[0]);
    const ctx = makeCtx(true);

    // session_start -> idle file
    handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    const path = join(hoisted.agentDir, "live", "sess-x.json");
    expect(existsSync(path)).toBe(true);
    expect(readState().state).toBe("idle");
    expect(readState().sessionFile).toBe("/x/sess-x.jsonl");
    expect(readState().model).toBe("anthropic/claude");

    // before_agent_start -> no state change (just cancels any pending idle timer)
    handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "hi" }, ctx);
    expect(readState().state).toBe("idle");

    // agent_start -> working
    handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    expect(readState().state).toBe("working");

    // herdr:blocked -> blocked with label
    api.events.emit("herdr:blocked", { active: true, label: "Allow rm -rf?" });
    expect(readState().state).toBe("blocked");
    expect(readState().blockedLabel).toBe("Allow rm -rf?");

    // unblock -> back to working
    api.events.emit("herdr:blocked", { active: false });
    expect(readState().state).toBe("working");

    // agent_end + debounce -> idle (agent_settled does not exist on real pi — D2)
    handlers.get("agent_end")?.({ type: "agent_end", messages: [] }, ctx);
    vi.advanceTimersByTime(250);
    expect(readState().state).toBe("idle");

    // quit -> file removed
    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    expect(existsSync(path)).toBe(false);
  });

  it("refreshes the model on model_select (provider/id)", () => {
    const { api, handlers } = makeApi();
    piPresence(api as unknown as Parameters<typeof piPresence>[0]);
    const ctx = makeCtx();
    handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    // ctx.model has no provider -> bare id
    expect(readState().model).toBe("anthropic/claude");

    handlers.get("model_select")?.(
      { type: "model_select", model: { id: "gpt-5", provider: "openai" }, source: "set" },
      ctx,
    );
    expect(readState().model).toBe("openai/gpt-5");
  });

  it("unlinks the file on every shutdown reason, not just quit (a following session_start rewrites it)", () => {
    const { api, handlers } = makeApi();
    piPresence(api as unknown as Parameters<typeof piPresence>[0]);
    const ctx = makeCtx();
    handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    const path = join(hoisted.agentDir, "live", "sess-x.json");
    expect(existsSync(path)).toBe(true);

    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "reload" }, ctx);
    expect(existsSync(path)).toBe(false);
  });

  it("respects enabled:false via settings.json (no state file is ever written)", () => {
    // Write a settings.json disabling the extension.
    const settingsPath = join(hoisted.agentDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ "pi-presence": { enabled: false } }));
    const { api, handlers } = makeApi();
    piPresence(api as unknown as Parameters<typeof piPresence>[0]);
    const ctx = makeCtx();
    handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    const path = join(hoisted.agentDir, "live", "sess-x.json");
    expect(existsSync(path)).toBe(false);
  });

  it("honors a trusted project's .pi/settings.json override (project wins when trusted)", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "pi-presence-trusted-proj-"));
    try {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(
        join(projectDir, ".pi", "settings.json"),
        JSON.stringify({ "pi-presence": { enabled: false } }),
      );
      const { api, handlers } = makeApi();
      piPresence(api as unknown as Parameters<typeof piPresence>[0]);
      const ctx = { ...makeCtx(), cwd: projectDir, isProjectTrusted: () => true };
      handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
      // Trusted project's enabled:false is honored -> nothing written.
      expect(existsSync(join(hoisted.agentDir, "live", "sess-x.json"))).toBe(false);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("ignores an untrusted project's .pi/settings.json (falls back to the global default)", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "pi-presence-untrusted-proj-"));
    try {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(
        join(projectDir, ".pi", "settings.json"),
        JSON.stringify({ "pi-presence": { enabled: false } }),
      );
      const { api, handlers } = makeApi();
      piPresence(api as unknown as Parameters<typeof piPresence>[0]);
      const ctx = { ...makeCtx(), cwd: projectDir, isProjectTrusted: () => false };
      handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
      // Untrusted project's enabled:false is ignored -> global default (true) applies.
      expect(existsSync(join(hoisted.agentDir, "live", "sess-x.json"))).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("only subscribes to event names that exist in pi's real (0.79.2) event list", () => {
    const { api, handlers } = makeApi();
    piPresence(api as unknown as Parameters<typeof piPresence>[0]);
    expect(handlers.size).toBeGreaterThan(0);
    for (const name of handlers.keys()) {
      expect(REAL_PI_EVENT_NAMES.has(name)).toBe(true);
    }
  });
});
