import {
  type FocusPlan,
  type ViewModel,
  buildFocusPlan,
  buildResumeCommand,
  executeFocus,
} from "@pi-presence/shared";
import type { JsonRpcRequest } from "./rpc.js";

// ---------------------------------------------------------------------------
// Host → plugin request handling. The host (Vee) sends requests to focus a
// session's terminal or fetch its resume command; the plugin replies with a
// JSON-RPC result. Pure and injectable so the routing is testable without
// spawning terminals.
// ---------------------------------------------------------------------------

export interface DispatchDeps {
  getViewModel: () => ViewModel;
  /** Injectable focus executor (defaults to the real one). */
  executeFocus?: (plan: FocusPlan) => boolean;
}

interface RpcResult {
  jsonrpc: "2.0";
  id: number | string;
  result: unknown;
}
interface RpcError {
  jsonrpc: "2.0";
  id: number | string;
  error: { code: number; message: string };
}

function err(id: number | string, code: number, message: string): RpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Handle one incoming request. Returns the response frame, or null for a
 * notification (no id) or an unroutable message.
 */
export function handleRequest(
  req: JsonRpcRequest,
  deps: DispatchDeps,
): RpcResult | RpcError | null {
  if (req.id === undefined) return null; // notification: nothing to reply

  const params = (req.params ?? {}) as { sessionId?: unknown };
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
  const runFocus = deps.executeFocus ?? executeFocus;

  switch (req.method) {
    case "presence/focus": {
      const s = deps.getViewModel().sessions.find((x) => x.id === sessionId);
      if (!s) return err(req.id, -32602, "unknown session");
      const plan = buildFocusPlan({ terminal: s.terminal, cwd: s.cwd });
      const focused = runFocus(plan);
      const resume = buildResumeCommand({
        sessionFile: s.sessionFile,
        sessionId: s.id,
        cwd: s.cwd,
      });
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { focused, strategy: plan.strategy, resume: resume.display },
      };
    }
    case "presence/resume": {
      const s = deps.getViewModel().sessions.find((x) => x.id === sessionId);
      if (!s) return err(req.id, -32602, "unknown session");
      const r = buildResumeCommand({ sessionFile: s.sessionFile, sessionId: s.id, cwd: s.cwd });
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { command: r.file, args: r.args, cwd: r.cwd, display: r.display },
      };
    }
    default:
      return err(req.id, -32601, `method not found: ${req.method}`);
  }
}
