import {
  DEFAULT_GC_TTL_MS,
  buildViewModel,
  getLiveDir,
  loadAllAndReconcile,
  normalizeTerminalName,
  pinsFilePath,
  readPinsFile,
  watchLive,
} from "@pi-presence/shared";
import {
  ghostAsViewSession,
  performFocus,
  performPin,
  performResume,
  performUnpin,
  resolvePinned,
  resolveSession,
} from "./commands.js";
import { parseDuration } from "./duration.js";
import { renderView } from "./render.js";

// ---------------------------------------------------------------------------
// pi-watch: a standalone terminal reader for the pi-presence live directory.
//
//   pi-watch                                  # live TUI
//   pi-watch --once                            # print once and exit
//   pi-watch --json                            # stream view-model JSON
//   pi-watch focus <query>                     # focus a session's terminal (or copy its resume)
//   pi-watch resume <query> [--pi-bin <path>]  # open a new terminal running `pi --session ...`
//   pi-watch pin <query>                       # pin a session — see PIN-SPEC.md
//   pi-watch unpin <query>                     # unpin a session (live or ghost)
//   pi-watch gc [--all] [--ttl <duration>]     # prune dormant state files
//
// Reading (default/--once/--json/focus/resume) never mutates disk — only
// `gc`, `pin`, and `unpin` do (the latter two only ever touch presence-pins.json).
// ---------------------------------------------------------------------------

const KNOWN_FLAGS = new Set([
  "--help",
  "-h",
  "--once",
  "--json",
  "--no-color",
  "--dir",
  "--all",
  "--ttl",
  "--pi-bin",
  "--width",
]);

// Flags that take a value as the following argv entry.
const VALUE_FLAGS = new Set(["--dir", "--ttl", "--pi-bin", "--width"]);

const USAGE = `pi-presence-watch — a live, grouped view of every pi session

Usage:
  pi-presence-watch [options]                  live TUI, redraws on change
  pi-presence-watch --once [options]           print once and exit
  pi-presence-watch --json [options]           emit the view model as JSON (once, or streamed while live)
  pi-presence-watch focus <query> [options]    focus a session's terminal, or copy
                                                its resume command to the clipboard
  pi-presence-watch resume <query> [options]   open a new terminal running \`pi --session ...\`
                                                for a dead/dormant session, or copy that command
  pi-presence-watch pin <query>                pin a session: shows in the Vee menu's 📌 PINNED
                                                section and is never pruned by gc until unpinned
  pi-presence-watch unpin <query>              unpin a session (works on a "ghost" pin too, whose
                                                state file is gone — see gc note below)
  pi-presence-watch gc [--all] [--ttl <dur>]   prune dormant (dead) session files (never a
                                                pinned one, regardless of --all/--ttl)

Options:
  --once             print once and exit instead of watching
  --json             emit the view model as JSON instead of formatted text
  --no-color         disable ANSI color
  --dir <path>       use this live dir instead of the default
  --width <cols>     render as if the terminal were this many columns wide,
                      instead of auto-detecting (also useful when piping)
  --pi-bin <path>    (resume only) path to the \`pi\` binary to relaunch with
                      (default: "pi", resolved via PATH)
  --all              (gc only) prune every dead session now, ignoring --ttl
  --ttl <duration>   (gc only) prune dead sessions older than this: 90s, 30m,
                      2h, 1d, or a bare number of seconds (default: 24h)
  -h, --help         show this help and exit

Environment:
  PI_PRESENCE_LIVE_DIR   live dir override (highest priority)
  PI_CODING_AGENT_DIR    pi agent-dir override (live dir becomes <dir>/live)
  PI_PRESENCE_TERMINAL   terminal app to use for focus/resume (iterm2 | ghostty |
                          terminal), overriding the session's recorded terminal

focus/resume/pin <query> match, most specific first: exact session id,
short-id suffix, exact session name, then a substring of the session name or
cwd. unpin <query> matches the same way, but only against pinned sessions
(including ghosts — a pin whose state file is gone).
`;

interface Options {
  once: boolean;
  json: boolean;
  color: boolean;
  all: boolean;
  dir: string;
  /** Absolute (preferred) or bare path to `pi`, for `resume`. */
  piBin: string;
  ttl?: string;
  /** Explicit `--width` override; unset means auto-detect at render time. */
  width?: number;
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
  const ttlIdx = argv.indexOf("--ttl");
  if (ttlIdx >= 0 && argv[ttlIdx + 1]) opts.ttl = argv[ttlIdx + 1] as string;
  const widthIdx = argv.indexOf("--width");
  if (widthIdx >= 0 && argv[widthIdx + 1]) {
    const n = Number.parseInt(argv[widthIdx + 1] as string, 10);
    if (Number.isFinite(n) && n > 0) opts.width = n;
  }
  return opts;
}

/**
 * The width to render at: the explicit `--width` override if given, else the
 * live terminal width, else `$COLUMNS`, else 80 (a sane default for pipes and
 * other non-TTY output). Re-read on every call so live mode picks up pane
 * resizes between refreshes.
 */
function effectiveWidth(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  if (process.stdout.columns && process.stdout.columns > 0) return process.stdout.columns;
  const env = Number.parseInt(process.env.COLUMNS ?? "", 10);
  if (Number.isFinite(env) && env > 0) return env;
  return 80;
}

function positionals(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (VALUE_FLAGS.has(a)) {
      i++; // skip its value
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}

/** The first flag-looking token that isn't recognized, or `undefined`. */
function findUnknownFlag(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (VALUE_FLAGS.has(a)) {
      i++; // skip its value, which may itself start with "-" (e.g. a negative number)
      continue;
    }
    if (a === "-" || !a.startsWith("-")) continue;
    if (!KNOWN_FLAGS.has(a)) return a;
  }
  return undefined;
}

function printUsage(stream: NodeJS.WritableStream): void {
  stream.write(USAGE);
}

function clearScreen(): void {
  process.stdout.write("\x1b[H\x1b[2J\x1b[3J");
}

/** Load the pin store once and build the view model from it — used by every command that needs `vm.pinned`. */
function buildPinnedViewModel(opts: Options) {
  const pins = readPinsFile(pinsFilePath(opts.dir));
  const vm = buildViewModel(loadAllAndReconcile(opts.dir, { pins }), Date.now(), pins);
  return { vm, pins };
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
  const { vm } = buildPinnedViewModel(opts);
  let res = resolveSession(vm, query);
  if (res.kind === "none") {
    // Not a live/dormant session — fall back to a ghost pin (state file gone)
    // so its Resume action keeps working, per PIN-SPEC AC7.
    const ghostRes = resolvePinned(vm, query);
    if (ghostRes.kind === "found")
      res = { kind: "found", session: ghostAsViewSession(ghostRes.row) };
    else if (ghostRes.kind === "ambiguous") {
      res = { kind: "ambiguous", matches: ghostRes.matches.map(ghostAsViewSession) };
    }
  }
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
  const configuredTerminal = process.env.PI_PRESENCE_TERMINAL;
  if (configuredTerminal && !normalizeTerminalName(configuredTerminal)) {
    process.stderr.write(
      `PI_PRESENCE_TERMINAL=${configuredTerminal} not recognized (expected iterm2|ghostty|terminal); using ${outcome.kind}\n`,
    );
  }
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
  let ttlMs = DEFAULT_GC_TTL_MS;
  if (opts.ttl !== undefined) {
    const parsed = parseDuration(opts.ttl);
    if (parsed === undefined) {
      process.stderr.write(
        `invalid --ttl value "${opts.ttl}" (expected e.g. 90s, 30m, 2h, 1d, or a bare number of seconds)\n`,
      );
      printUsage(process.stderr);
      return 1;
    }
    ttlMs = parsed;
  }
  if (opts.all) ttlMs = 1; // prune anything dead, regardless of age

  const pins = readPinsFile(pinsFilePath(opts.dir));
  const before = loadAllAndReconcile(opts.dir, { pins }).length;
  const result = loadAllAndReconcile(opts.dir, { gcTtlMs: ttlMs, prune: true, pins });
  const after = loadAllAndReconcile(opts.dir, { pins }).length;
  const pruned = Math.max(0, before - after);
  // Pinned + dead + past the TTL is exactly what would have been pruned above
  // had it not been protected — count it so gc's output isn't silent about it.
  const skippedPinned = result.filter(
    (s) => s.pinned && s.liveState === "dormant" && s.ageMs > ttlMs,
  ).length;
  const parts = [`pruned ${pruned} dormant session file${pruned === 1 ? "" : "s"}`];
  if (skippedPinned > 0) {
    parts.push(`skipped ${skippedPinned} pinned session${skippedPinned === 1 ? "" : "s"}`);
  }
  process.stdout.write(`${parts.join(", ")}\n`);
  return 0;
}

function runPin(query: string, opts: Options): number {
  const pinsPath = pinsFilePath(opts.dir);
  const { vm } = buildPinnedViewModel(opts);
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
  const result = performPin(res.session, pinsPath);
  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }
  process.stdout.write(`pinned ${res.session.name}\n`);
  return 0;
}

function runUnpin(query: string, opts: Options): number {
  const pinsPath = pinsFilePath(opts.dir);
  const { vm } = buildPinnedViewModel(opts);
  const res = resolvePinned(vm, query);
  if (res.kind === "none") {
    process.stderr.write(`no pinned session matching "${query}"\n`);
    return 1;
  }
  if (res.kind === "ambiguous") {
    process.stderr.write(`"${query}" matches multiple pinned sessions:\n`);
    for (const r of res.matches) process.stderr.write(`  ${r.name}  #${r.sessionId}  ${r.cwd}\n`);
    return 1;
  }
  performUnpin(res.row, pinsPath);
  process.stdout.write(`unpinned ${res.row.name}\n`);
  return 0;
}

function runOnce(opts: Options): void {
  const { vm } = buildPinnedViewModel(opts);
  if (opts.json) process.stdout.write(`${JSON.stringify(vm, null, 2)}\n`);
  else {
    const width = effectiveWidth(opts.width);
    process.stdout.write(`${renderView(vm, { color: opts.color, width }).join("\n")}\n`);
  }
}

function runLive(opts: Options): void {
  const dispose = watchLive(opts.dir, (snaps) => {
    // Read fresh on every tick: watchLive's options are fixed at setup time,
    // so this is the only way pin/unpin done while live is running gets
    // picked up (loadAllAndReconcile itself auto-loads pins for gc-protection
    // + `snapshot.pinned`; this is only for `vm.pinned`'s ghost-inclusive data).
    const pins = readPinsFile(pinsFilePath(opts.dir));
    const vm = buildViewModel(snaps, Date.now(), pins);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(vm)}\n`);
      return;
    }
    // Re-read the width every refresh (not hoisted out of the callback) so a
    // pane resize between refreshes is picked up on the next repaint.
    const width = effectiveWidth(opts.width);
    clearScreen();
    process.stdout.write(`${renderView(vm, { color: opts.color, width }).join("\n")}\n`);
    if (opts.color) process.stdout.write("\x1b[90m(watching — Ctrl-C to exit)\x1b[0m\n");
  });
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

  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage(process.stdout);
    process.exit(0);
  }

  const unknown = findUnknownFlag(argv);
  if (unknown) {
    process.stderr.write(`unknown option: ${unknown}\n`);
    printUsage(process.stderr);
    process.exit(1);
  }

  const widthIdx = argv.indexOf("--width");
  const rawWidth = widthIdx >= 0 ? argv[widthIdx + 1] : undefined;
  if (rawWidth !== undefined && !(/^\d+$/.test(rawWidth) && Number(rawWidth) > 0)) {
    process.stderr.write(`invalid --width value "${rawWidth}" (expected a positive integer)\n`);
    printUsage(process.stderr);
    process.exit(1);
  }

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
  if (command === "pin") {
    const query = positionals(argv).slice(1).join(" ");
    process.exit(runPin(query, opts));
  }
  if (command === "unpin") {
    const query = positionals(argv).slice(1).join(" ");
    process.exit(runUnpin(query, opts));
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
