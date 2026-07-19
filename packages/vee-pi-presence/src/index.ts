#!/usr/bin/env node
import {
  DEFAULT_GC_TTL_MS,
  type ViewModel,
  buildViewModel,
  getLiveDir,
  watchLive,
} from "@pi-presence/shared";
import { ViewPublisher } from "./adapter.js";
import { handleRequest } from "./dispatch.js";
import { createLineDecoder, encodeMessage } from "./rpc.js";

// ---------------------------------------------------------------------------
// vee-pi-presence: the reader process Vee (or any host) launches. It speaks
// newline-delimited JSON-RPC over stdio:
//   plugin -> host:  presence/replace (initial), presence/patch (deltas)
//   host   -> plugin: presence/focus, presence/resume (id'd requests)
// All diagnostics go to stderr; stdout carries frames only.
// ---------------------------------------------------------------------------

function main(): void {
  const liveDir = getLiveDir();
  let currentVm: ViewModel = buildViewModel([]);
  const publisher = new ViewPublisher();
  const write = (msg: object): void => {
    process.stdout.write(encodeMessage(msg));
  };

  const dispose = watchLive(
    liveDir,
    (snaps) => {
      currentVm = buildViewModel(snaps);
      for (const m of publisher.next(currentVm)) write(m);
    },
    { gcTtlMs: DEFAULT_GC_TTL_MS },
  );

  const decode = createLineDecoder();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    for (const req of decode(chunk)) {
      const res = handleRequest(req, { getViewModel: () => currentVm });
      if (res) write(res);
    }
  });

  const shutdown = () => {
    dispose();
    process.exit(0);
  };
  process.stdin.on("end", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.stderr.write(`vee-pi-presence: watching ${liveDir}\n`);
}

main();
