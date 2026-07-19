import type { EventBus } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Blocked-state tracker.
//
// pi-presence is a CONSUMER of the cooperative `herdr:blocked` convention on the
// shared event bus. Any extension that puts pi into a "needs-you" wait (a
// permission gate, pi-worktree, herdr itself) emits:
//
//     pi.events.emit("herdr:blocked", { active: true,  label?: string })
//     pi.events.emit("herdr:blocked", { active: false })
//
// Multiple producers may overlap, so we ref-count: the session is blocked while
// depth > 0 and unblocked when it returns to 0. This matches the herdr contract;
// the exact payload/ref-count semantics are documented in the README so other
// authors emit the same shape.
// ---------------------------------------------------------------------------

/** The cross-extension blocked-state event payload. */
export interface BlockedPayload {
  active: boolean;
  label?: string;
}

export interface BlockedCallbacks {
  onBlocked: (label: string | undefined) => void;
  onUnblocked: () => void;
}

/** Channel name for the cooperative blocked-state convention. */
export const BLOCKED_CHANNEL = "herdr:blocked";

/**
 * Subscribe to the blocked convention with ref-counting. Returns an unsubscribe
 * function. Only the 0→1 and 1→0 depth transitions invoke the callbacks.
 */
export function installBlockedTracker(events: EventBus, cb: BlockedCallbacks): () => void {
  let depth = 0;
  let label: string | undefined;

  return events.on(BLOCKED_CHANNEL, (data: unknown) => {
    const payload = data as Partial<BlockedPayload> | null;
    if (!payload || typeof payload.active !== "boolean") return;

    if (payload.active) {
      if (typeof payload.label === "string" && payload.label.length > 0) label = payload.label;
      depth += 1;
      if (depth === 1) cb.onBlocked(label);
    } else {
      // Guard against underflow: an unbalanced deactivate at depth 0 must not
      // fire onUnblocked.
      if (depth === 0) return;
      depth -= 1;
      if (depth === 0) {
        label = undefined;
        cb.onUnblocked();
      }
    }
  });
}
