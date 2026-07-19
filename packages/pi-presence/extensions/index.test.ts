import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

    // agent_settled + debounce -> idle
    handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
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

  it("keeps the file on a non-quit shutdown (reload rebind)", () => {
    const { api, handlers } = makeApi();
    piPresence(api as unknown as Parameters<typeof piPresence>[0]);
    const ctx = makeCtx();
    handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    const path = join(hoisted.agentDir, "live", "sess-x.json");
    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "reload" }, ctx);
    expect(existsSync(path)).toBe(true);
  });

  it("respects enabled:false via settings.json", () => {
    // Write a settings.json disabling the extension.
    const settingsPath = join(hoisted.agentDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ "pi-presence": { enabled: false } }));
    const { api, handlers } = makeApi();
    piPresence(api as unknown as Parameters<typeof piPresence>[0]);
    // No handlers registered when disabled.
    expect(handlers.size).toBe(0);
  });
});
