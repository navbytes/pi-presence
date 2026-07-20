import { join } from "node:path";
import { resolveAgentDir } from "./pi-agent-dir.js";

// The extension resolves the live directory through pi's own CONFIG_DIR_NAME-
// aware agent dir (which honors PI_CODING_AGENT_DIR and custom configDir
// builds), then appends `live/`. Readers replicate this in `@pi-presence/shared`.
// Goes through pi-agent-dir.ts's resilient resolver rather than importing
// getAgentDir directly — see that module for why (defects-wave1.md D1).

/** Directory holding per-session state files (`<agentDir>/live`). */
export function getLiveDir(): string {
  return join(resolveAgentDir(), "live");
}

/** Absolute path of the state file for a session id. */
export function stateFilePath(sessionId: string): string {
  return join(getLiveDir(), `${sessionId}.json`);
}
