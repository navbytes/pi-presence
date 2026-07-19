#!/usr/bin/env node
import {
  DEFAULT_GC_TTL_MS,
  buildViewModel,
  getLiveDir,
  loadAllAndReconcile,
  watchLive,
} from "@pi-presence/shared";
import { renderView } from "./render.js";

// ---------------------------------------------------------------------------
// pi-watch: a standalone terminal reader for the pi-presence live directory.
// Run it in any terminal to see every pi session grouped by state, live.
//
//   tsx packages/pi-watch/src/index.ts          # live TUI
//   tsx packages/pi-watch/src/index.ts --once    # print once and exit
//   tsx packages/pi-watch/src/index.ts --json     # stream view-model JSON
// ---------------------------------------------------------------------------

interface Options {
  once: boolean;
  json: boolean;
  color: boolean;
  dir: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    once: argv.includes("--once"),
    json: argv.includes("--json"),
    color: !argv.includes("--no-color") && Boolean(process.stdout.isTTY),
    dir: getLiveDir(),
  };
  const dirIdx = argv.indexOf("--dir");
  if (dirIdx >= 0 && argv[dirIdx + 1]) opts.dir = argv[dirIdx + 1] as string;
  return opts;
}

function clearScreen(): void {
  process.stdout.write("\x1b[H\x1b[2J\x1b[3J");
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.once) {
    const snaps = loadAllAndReconcile(opts.dir, { gcTtlMs: DEFAULT_GC_TTL_MS });
    const vm = buildViewModel(snaps);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(vm, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderView(vm, { color: opts.color }).join("\n")}\n`);
    }
    return;
  }

  const dispose = watchLive(
    opts.dir,
    (snaps) => {
      const vm = buildViewModel(snaps);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(vm)}\n`);
        return;
      }
      clearScreen();
      process.stdout.write(`${renderView(vm, { color: opts.color }).join("\n")}\n`);
      if (opts.color) process.stdout.write("\x1b[90m(watching — Ctrl-C to exit)\x1b[0m\n");
    },
    { gcTtlMs: DEFAULT_GC_TTL_MS },
  );

  const shutdown = () => {
    dispose();
    process.stdout.write("\n");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
