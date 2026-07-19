import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// The extension resolves the live directory through pi's own CONFIG_DIR_NAME-
// aware `getAgentDir()` (which honors PI_CODING_AGENT_DIR and custom configDir
// builds), then appends `live/`. Readers replicate this in `@pi-presence/shared`.

/** Directory holding per-session state files (`<agentDir>/live`). */
export function getLiveDir(): string {
  return join(getAgentDir(), "live");
}

/** Absolute path of the state file for a session id. */
export function stateFilePath(sessionId: string): string {
  return join(getLiveDir(), `${sessionId}.json`);
}
