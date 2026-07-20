import {
  DEFAULT_GC_TTL_MS,
  buildViewModel,
  getLiveDir,
  loadAllAndReconcile,
  watchLive,
} from "@pi-presence/shared";
import { performFocus, performResume, resolveSession } from "./commands.js";
import { renderView } from "./render.js";

// ---------------------------------------------------------------------------
// pi-watch: a standalone terminal reader for the pi-presence live directory.
//
//   pi-watch                 # live TUI
//   pi-watch --once           # print once and exit
//   pi-watch --json           # stream view-model JSON
//   pi-watch focus <query>    # focus a session's terminal (or copy its resume)
//   pi-watch resume <query>   # open a new terminal running `pi --session ...`
//   pi-watch gc [--all]       # prune dormant state files
// ---------------------------------------------------------------------------

interface Options {
  once: boolean;
  json: boolean;
  color: boolean;
  all: boolean;
  dir: string;
  /** Absolute (preferred) or bare path to `pi`, for `resume`. */
  piBin: string;
}

function parseOptions(argv: string[]): Options {
  const opts: Options = {
    once: argv.includes("--once"),
    json: argv.includes("--json"),
    color: !argv.includes("--no-color") && Boolean(process.stdout.isTTY),
    all: argv.includes("--all"),
    dir: getLiveDir(),
    piBin: "pi",
  };
  const dirIdx = argv.indexOf("--dir");
  if (dirIdx >= 0 && argv[dirIdx + 1]) opts.dir = argv[dirIdx + 1] as string;
  const piBinIdx = argv.indexOf("--pi-bin");
  if (piBinIdx >= 0 && argv[piBinIdx + 1]) opts.piBin = argv[piBinIdx + 1] as string;
  return opts;
}

function positionals(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--dir" || a === "--pi-bin") {
      i++; // skip its value
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}

function clearScreen(): void {
  process.stdout.write("\x1b[H\x1b[2J\x1b[3J");
}

function runFocus(query: string, opts: Options): number {
  const vm = buildViewModel(loadAllAndReconcile(opts.dir));
  const res = resolveSession(vm, query);
  if (res.kind === "none") {
    process.stderr.write(`no session matching "${query}"\n`);
    return 1;
  }
  if (res.kind === "ambiguous") {
    process.stderr.write(`"${query}" matches multiple sessions:\n`);
    for (const s of res.matches) process.stderr.write(`  ${s.name}  #${s.id}  ${s.cwd}\n`);
    return 1;
  }
  const outcome = performFocus(res.session);
  if (outcome.focused) {
    process.stdout.write(`focused ${res.session.name} (${outcome.strategy})\n`);
  } else if (outcome.copied) {
    process.stdout.write(
      `could not focus; copied resume command to clipboard:\n  ${outcome.resume}\n`,
    );
  } else {
    process.stdout.write(`could not focus. resume with:\n  ${outcome.resume}\n`);
  }
  return 0;
}

function runResume(query: string, opts: Options): number {
  const vm = buildViewModel(loadAllAndReconcile(opts.dir));
  const res = resolveSession(vm, query);
  if (res.kind === "none") {
    process.stderr.write(`no session matching "${query}"\n`);
    return 1;
  }
  if (res.kind === "ambiguous") {
    process.stderr.write(`"${query}" matches multiple sessions:\n`);
    for (const s of res.matches) process.stderr.write(`  ${s.name}  #${s.id}  ${s.cwd}\n`);
    return 1;
  }
  const outcome = performResume(res.session, opts.piBin);
  if (outcome.launched) {
    process.stdout.write(`resuming ${res.session.name} in ${outcome.kind}\n`);
  } else if (outcome.copied) {
    process.stdout.write(
      `could not open a terminal; copied resume command to clipboard:\n  ${outcome.resume}\n`,
    );
  } else {
    process.stdout.write(`could not open a terminal. resume with:\n  ${outcome.resume}\n`);
  }
  return 0;
}

function runGc(opts: Options): number {
  const before = loadAllAndReconcile(opts.dir).length;
  loadAllAndReconcile(opts.dir, { gcTtlMs: opts.all ? 1 : DEFAULT_GC_TTL_MS });
  const after = loadAllAndReconcile(opts.dir).length;
  const pruned = Math.max(0, before - after);
  process.stdout.write(`pruned ${pruned} dormant session file${pruned === 1 ? "" : "s"}\n`);
  return 0;
}

function runOnce(opts: Options): void {
  const vm = buildViewModel(loadAllAndReconcile(opts.dir, { gcTtlMs: DEFAULT_GC_TTL_MS }));
  if (opts.json) process.stdout.write(`${JSON.stringify(vm, null, 2)}\n`);
  else process.stdout.write(`${renderView(vm, { color: opts.color }).join("\n")}\n`);
}

function runLive(opts: Options): void {
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

function main(): void {
  const argv = process.argv.slice(2);
  const opts = parseOptions(argv);
  const [command] = positionals(argv);

  if (command === "focus") {
    const query = positionals(argv).slice(1).join(" ");
    process.exit(runFocus(query, opts));
  }
  if (command === "resume") {
    const query = positionals(argv).slice(1).join(" ");
    process.exit(runResume(query, opts));
  }
  if (command === "gc") {
    process.exit(runGc(opts));
  }
  if (opts.once) {
    runOnce(opts);
    return;
  }
  runLive(opts); // streams JSON when --json is set
}

main();
