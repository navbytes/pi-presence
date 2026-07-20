# pi-presence-watch

A standalone terminal reader for [pi-presence](https://github.com/navbytes/pi-presence).
Renders a live, grouped list of every pi session — **needs-you → running → idle →
dormant** — and can focus a session's terminal or prune dead ones.

```sh
npx pi-presence-watch                    # live TUI (repaints on change)
npx pi-presence-watch --once              # print once and exit
npx pi-presence-watch --json              # stream the view model as JSON
npx pi-presence-watch --no-color          # disable ANSI color
npx pi-presence-watch --dir <path>        # watch a specific live dir
npx pi-presence-watch --width <cols>      # render at this width instead of auto-detecting
npx pi-presence-watch --help              # print usage and exit

npx pi-presence-watch focus <query>       # focus a session's terminal, or copy its
                                          # resume command to the clipboard as a fallback.
                                          # <query> matches id / short-id / name / cwd.
npx pi-presence-watch resume <query> [--pi-bin <path>]
                                          # open a new terminal running `pi --session ...`
                                          # for a dead/dormant session (or copy that command).
npx pi-presence-watch pin <query>         # pin a session — 📌 in the TUI, its own menu
                                          # section in the Vee plugin, never gc'd until unpinned.
npx pi-presence-watch unpin <query>       # unpin a session (also resolves a "ghost" pin
                                          # whose state file is already gone).
npx pi-presence-watch gc [--all] [--ttl <duration>]
                                          # prune dormant state files (past the 24h
                                          # default TTL; --ttl overrides it, e.g. 90s,
                                          # 30m, 2h, 1d; --all prunes every dead
                                          # session immediately — but never a pinned one)
```

Any unrecognized flag prints a one-line error and the usage text, then exits 1
(instead of silently starting the live TUI).

It watches `<agentDir>/live/` (or `$PI_PRESENCE_LIVE_DIR`, or
`$PI_CODING_AGENT_DIR/live`) via `fs.watch` plus a periodic liveness reconcile.

**Reading never deletes.** The live TUI, `--once`, `--json`, `focus`, and
`resume` only ever read and classify state files — a dead session's file
survives on disk however old it is. Only the explicit `gc` command (with
`--ttl`/`--all`) prunes dead files.

`focus`/`resume` pick a terminal app in this order: `$PI_PRESENCE_TERMINAL`
(iterm2 | ghostty | terminal), then the session's own recorded terminal, then
Terminal.app. When nothing can be opened (e.g. no GUI, unknown terminal), the
resume command is copied to the clipboard instead.

**Pinning** keeps a session reachable across dormancy. `pin`/`unpin <query>`
resolve the same way as `focus`/`resume` (id / short-id / name / cwd). Pins
live in `<agentDir>/presence-pins.json` (a sibling of `live/`, capped at 20,
plain JSON so they survive a restart) and are never treated as a session file
by any reader. A pinned session's state file is never pruned by `gc` — with
or without `--all`/`--ttl` — until it's unpinned; `gc`'s output reports how
many pinned sessions it skipped. If a pin's backing file disappears outside
of `gc` (a manual `rm`, or an id/file that didn't carry over on resume), it
degrades to a "ghost" entry — cached name/cwd, resumable, unpin-able — rather
than erroring or vanishing. The TUI prefixes a pinned row with `📌` in its
usual group; the [Vee plugin](../vee-plugin) additionally gives pins their
own `📌 PINNED` menu section.

**Every line fits the terminal.** Output is measured and reshaped to the
detected width (`--width`, else the live terminal width, else `$COLUMNS`, else
80) instead of being left for the terminal to hard-wrap. As the pane narrows,
lower-value fields drop first — model, then branch/`#id`, then the working
directory (tail-truncated: `…/nested/project/dir`) — while the session name
and age are always shown, and a blocked session's reason is always shown too
(inline when it fits, else on its own indented line right under the name). In
live mode the width is re-read on every repaint, so resizing the pane reshapes
the next frame.

Ships as a single bundled, zero-dependency CLI (built with esbuild); the
`@pi-presence/shared` reader library is inlined. All logic is unit-tested; the
terminal driver in `src/index.ts` is a thin wrapper.
