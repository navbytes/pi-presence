import { type PatchOp, type ViewModel, type ViewSession, compare } from "@pi-presence/shared";

// ---------------------------------------------------------------------------
// View publisher: turns a stream of view models into JSON-RPC notifications —
// a full `presence/replace` on first render, then minimal `presence/patch`
// (RFC 6902) deltas.
//
// Volatile fields are stripped before diffing AND sending: `generatedAt` and
// per-session `ageMs` change on every reconcile tick and would otherwise emit a
// patch every 5s with no real change. The client recomputes ages from the
// absolute `updatedAt`.
// ---------------------------------------------------------------------------

/** A session as sent to the host (no derived `ageMs`). */
export type ClientSession = Omit<ViewSession, "ageMs">;

export interface ClientView {
  counts: ViewModel["counts"];
  sessions: ClientSession[];
}

export type PresenceMessage =
  | { jsonrpc: "2.0"; method: "presence/replace"; params: ClientView }
  | { jsonrpc: "2.0"; method: "presence/patch"; params: PatchOp[] };

/** Strip volatile fields so equal states diff to nothing. */
export function projectForClient(vm: ViewModel): ClientView {
  return {
    counts: vm.counts,
    sessions: vm.sessions.map(({ ageMs: _ageMs, ...rest }) => rest),
  };
}

export class ViewPublisher {
  private last: ClientView | undefined;

  /** Compute the messages to emit for a new view model (possibly none). */
  next(vm: ViewModel): PresenceMessage[] {
    const view = projectForClient(vm);
    if (!this.last) {
      this.last = view;
      return [{ jsonrpc: "2.0", method: "presence/replace", params: view }];
    }
    const ops = compare(this.last, view);
    this.last = view;
    if (ops.length === 0) return [];
    return [{ jsonrpc: "2.0", method: "presence/patch", params: ops }];
  }

  /** Force the next `next()` to emit a full replace. */
  reset(): void {
    this.last = undefined;
  }
}
