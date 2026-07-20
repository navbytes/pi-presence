import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Live-directory resolution for pi-free readers.
//
// The pi extension resolves the agent dir via pi's own CONFIG_DIR_NAME-aware
// `getAgentDir()`. This module replicates the resolution for readers that must
// NOT depend on pi:
//
//   1. `PI_PRESENCE_LIVE_DIR`  — explicit override (also covers custom
//      configDir builds of pi that a pi-free reader cannot otherwise detect).
//   2. `PI_CODING_AGENT_DIR`   — pi's own agent-dir override (tilde-expanded).
//   3. `~/.pi/agent`           — the default.
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG_DIR = ".pi";
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const LIVE_DIR_ENV = "PI_PRESENCE_LIVE_DIR";
const LIVE_SUBDIR = "live";
const PINS_FILENAME = "presence-pins.json";

/** Expand a leading `~` / `~/` to the user's home directory. */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

/** Resolve the pi agent directory (e.g. `~/.pi/agent`). */
export function getAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[AGENT_DIR_ENV]?.trim();
  if (override) return expandTilde(override);
  return join(homedir(), DEFAULT_CONFIG_DIR, "agent");
}

/** Resolve the directory holding per-session state files. */
export function getLiveDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[LIVE_DIR_ENV]?.trim();
  if (override) return expandTilde(override);
  return join(getAgentDir(env), LIVE_SUBDIR);
}

/** Absolute path of the state file for a given session id. */
export function stateFilePath(sessionId: string, liveDir: string = getLiveDir()): string {
  return join(liveDir, `${sessionId}.json`);
}

/**
 * Absolute path of the pin store: a sibling of `live/` (not inside it), so gc
 * and the readers' directory scan never treat it as a session file.
 */
export function pinsFilePath(liveDir: string = getLiveDir()): string {
  return join(dirname(liveDir), PINS_FILENAME);
}
