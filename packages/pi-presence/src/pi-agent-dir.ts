import { homedir } from "node:os";
import { join } from "node:path";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Resilience shim for @earendil-works/pi-coding-agent's runtime export surface.
//
// pi 0.79.2's real dist/index.js does not re-export `CONFIG_DIR_NAME` (only
// added in a later release; the repo's devDependency floor already requires
// it). A plain `import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent"`
// silently binds `undefined` under jiti (pi's own loader treats a missing
// named export as `undefined` rather than a hard resolution error), which
// crashed every session two frames later inside `path.join()` instead of
// failing loudly. Every runtime (non-type) import of pi's config helpers goes
// through this module so a missing export degrades to pi's own defaults
// instead of taking the extension down. See handoffs/research-pi-api.md and
// handoffs/defects-wave1.md D1.
// ---------------------------------------------------------------------------

// Re-typed as optional: the installed devDependency's .d.ts claims these are
// always present, which is exactly the mismatch we're defending against.
const mod: { CONFIG_DIR_NAME?: string; getAgentDir?: () => string } = piCodingAgent;

/** pi's project-config directory name (`.pi` by default; mirrors config.js). */
export function configDirName(): string {
  return mod.CONFIG_DIR_NAME ?? ".pi";
}

/** pi's agent directory (`~/.pi/agent` by default), self-contained fallback. */
export function resolveAgentDir(): string {
  if (typeof mod.getAgentDir === "function") return mod.getAgentDir();
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), configDirName(), "agent");
}
