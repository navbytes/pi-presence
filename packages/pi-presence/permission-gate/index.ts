import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifyCommand } from "../src/classify.js";

// ---------------------------------------------------------------------------
// Optional bundled extension: a PRODUCER of the `herdr:blocked` convention.
//
// It is NOT loaded by default (the package manifest ships only
// extensions/index.ts). Opt in by force-loading it, e.g.:
//
//   pi install npm:pi-presence
//   # settings.json packages entry:
//   { "source": "npm:pi-presence", "extensions": ["+permission-gate/index.ts"] }
//
// When the model runs a risky bash command it brackets pi's own confirm dialog
// with herdr:blocked {active:true,label} / {active:false}, so pi-presence (and
// herdr, pi-worktree, …) show a "needs-you" state while awaiting the decision.
// This makes pi-presence self-sufficient without requiring herdr to be present.
// ---------------------------------------------------------------------------

export default function permissionGate(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    // `event.input` narrows to `BashToolInput | Record<string, unknown>` (a
    // custom tool could also be named "bash"), so validate the command shape.
    const rawCommand = (event.input as { command?: unknown }).command;
    const command = typeof rawCommand === "string" ? rawCommand : "";
    if (!command) return;

    const risk = classifyCommand(command);
    if (!risk.dangerous) return;

    // Without dialog-capable UI we cannot prompt; leave gating to pi itself.
    if (!ctx.hasUI) return;

    pi.events.emit("herdr:blocked", { active: true, label: risk.label });
    try {
      const approved = await ctx.ui.confirm(`pi-presence: ${risk.label}?`, command);
      if (!approved) {
        return { block: true, reason: `Blocked by pi-presence permission gate: ${risk.label}` };
      }
    } finally {
      pi.events.emit("herdr:blocked", { active: false });
    }
  });
}
