import { type ViewModel, buildViewModel } from "@pi-presence/shared";
import { SCHEMA_VERSION, type StateFile } from "@pi-presence/shared";
import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "./dispatch.js";

function vmWith(id: string, terminalProgram: string | null): ViewModel {
  const file: StateFile = {
    schema: SCHEMA_VERSION,
    sessionId: id,
    sessionFile: `/x/${id}.jsonl`,
    sessionName: id,
    state: "working",
    blockedLabel: null,
    cwd: `/home/u/${id}`,
    branch: null,
    model: null,
    pid: 1,
    startTime: 0,
    bootId: null,
    nonce: "",
    updatedAt: 1,
    terminal: { program: terminalProgram, itermSessionId: terminalProgram ? "sid" : null },
  };
  return buildViewModel([
    { path: `/live/${id}.json`, file, liveness: "alive", liveState: "working", ageMs: 0 },
  ]);
}

describe("handleRequest", () => {
  it("focuses a known session and reports strategy + resume", () => {
    const focus = vi.fn(() => true);
    const res = handleRequest(
      { jsonrpc: "2.0", id: 1, method: "presence/focus", params: { sessionId: "a" } },
      { getViewModel: () => vmWith("a", "iTerm.app"), executeFocus: focus },
    );
    expect(focus).toHaveBeenCalledOnce();
    expect(res).toMatchObject({
      id: 1,
      result: { focused: true, strategy: "iterm2", resume: "pi --session /x/a.jsonl" },
    });
  });

  it("errors on an unknown session", () => {
    const res = handleRequest(
      { jsonrpc: "2.0", id: 2, method: "presence/focus", params: { sessionId: "nope" } },
      { getViewModel: () => vmWith("a", "iTerm.app"), executeFocus: () => true },
    );
    expect(res).toMatchObject({ id: 2, error: { code: -32602 } });
  });

  it("returns a resume command", () => {
    const res = handleRequest(
      { jsonrpc: "2.0", id: 3, method: "presence/resume", params: { sessionId: "a" } },
      { getViewModel: () => vmWith("a", null) },
    );
    expect(res).toMatchObject({
      id: 3,
      result: {
        command: "pi",
        args: ["--session", "/x/a.jsonl"],
        display: "pi --session /x/a.jsonl",
      },
    });
  });

  it("returns method-not-found for unknown methods", () => {
    const res = handleRequest(
      { jsonrpc: "2.0", id: 4, method: "bogus" },
      { getViewModel: () => vmWith("a", null) },
    );
    expect(res).toMatchObject({ id: 4, error: { code: -32601 } });
  });

  it("ignores notifications (no id)", () => {
    const res = handleRequest(
      { jsonrpc: "2.0", method: "presence/focus", params: { sessionId: "a" } },
      { getViewModel: () => vmWith("a", null) },
    );
    expect(res).toBeNull();
  });
});
