import type { EventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { BLOCKED_CHANNEL, installBlockedTracker } from "./blocked.js";

function makeBus(): EventBus & { fire: (data: unknown) => void; count: () => number } {
  const handlers: Array<(d: unknown) => void> = [];
  return {
    on(channel, handler) {
      expect(channel).toBe(BLOCKED_CHANNEL);
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    emit() {},
    fire(data) {
      for (const h of [...handlers]) h(data);
    },
    count() {
      return handlers.length;
    },
  };
}

describe("installBlockedTracker", () => {
  it("invokes onBlocked at depth 0→1 with the label and onUnblocked at 1→0", () => {
    const bus = makeBus();
    const onBlocked = vi.fn();
    const onUnblocked = vi.fn();
    installBlockedTracker(bus, { onBlocked, onUnblocked });

    bus.fire({ active: true, label: "Allow rm -rf?" });
    expect(onBlocked).toHaveBeenCalledOnce();
    expect(onBlocked).toHaveBeenCalledWith("Allow rm -rf?");

    bus.fire({ active: false });
    expect(onUnblocked).toHaveBeenCalledOnce();
  });

  it("ref-counts nested producers without double-firing", () => {
    const bus = makeBus();
    const onBlocked = vi.fn();
    const onUnblocked = vi.fn();
    installBlockedTracker(bus, { onBlocked, onUnblocked });

    bus.fire({ active: true, label: "a" });
    bus.fire({ active: true, label: "b" });
    expect(onBlocked).toHaveBeenCalledOnce();

    bus.fire({ active: false });
    expect(onUnblocked).not.toHaveBeenCalled(); // depth still 1
    bus.fire({ active: false });
    expect(onUnblocked).toHaveBeenCalledOnce();
  });

  it("ignores malformed payloads", () => {
    const bus = makeBus();
    const onBlocked = vi.fn();
    installBlockedTracker(bus, { onBlocked, onUnblocked: vi.fn() });
    bus.fire(null);
    bus.fire({});
    bus.fire({ active: "yes" });
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("does not underflow below depth 0", () => {
    const bus = makeBus();
    const onUnblocked = vi.fn();
    installBlockedTracker(bus, { onBlocked: vi.fn(), onUnblocked });
    bus.fire({ active: false });
    bus.fire({ active: false });
    expect(onUnblocked).not.toHaveBeenCalled();
  });

  it("unsubscribes", () => {
    const bus = makeBus();
    const off = installBlockedTracker(bus, { onBlocked: vi.fn(), onUnblocked: vi.fn() });
    expect(bus.count()).toBe(1);
    off();
    expect(bus.count()).toBe(0);
  });
});
