# Changelog

## 0.2.0

### Added

- Session pinning: `pin <query>` / `unpin <query>` (same id/short-id/name/cwd
  resolution as `focus`/`resume`) keep a session quickly reachable across
  dormancy. Pins live in `<agentDir>/presence-pins.json` (sibling of `live/`,
  capped at 20), survive a process restart, and are never parsed as a session
  file by `gc`, `--once`, or the live TUI. `gc` (default and `--all`) now
  never deletes a pinned session's state file — expiry protection is the
  point — and its output reports a "skipped N pinned" count when that
  happens; unpinning re-exposes the session to gc immediately. The TUI marks
  pinned rows with a `📌` prefix inline in their existing group (no layout
  change); the Vee plugin adds a dedicated `📌 PINNED` section above `NEEDS
  YOU` (a pinned session shows there only, not duplicated in its group) plus
  Pin/Unpin submenu actions on every row. If a pin's state file goes away
  outside of gc (manual `rm`, or an id/file that didn't survive a resume as
  expected), it degrades to a "ghost" row — cached name/cwd, Resume + Unpin
  only — instead of throwing or silently disappearing.

### Fixed

- `--help`/`-h` now prints usage and exits 0; any unrecognized flag now prints
  a one-line error plus usage and exits 1. Previously both silently started
  the live TUI, which looked like a hang.
- Reading no longer deletes anything. `--once`, `--json`, and the live TUI
  used to silently unlink TTL-expired dormant state files as a side effect of
  just reading them (`focus`/`resume` never did this — they never passed a GC
  TTL); pruning is now opt-in (`{ prune: true }`) on all read paths, and only
  the explicit `gc` command sets it.
- The PID-reuse guard now works on macOS. It shelled out to `ps -o etimes=`
  (GNU/procps), which BSD `ps` on macOS rejects ("etimes: keyword not
  found"), so the start-time check silently no-op'd on the primary target
  platform. It now falls back to `ps -o etime=` (`[[dd-]hh:]mm:ss`) and parses
  that instead.
- `gc --ttl <duration>` lets you override the default 24h prune threshold,
  e.g. `90s`, `30m`, `2h`, `1d`, or a bare number of seconds. `--all` still
  prunes every dead session immediately, ignoring `--ttl`.
- Output now fits the terminal instead of being left for it to hard-wrap.
  Every session was previously one unbounded line (up to 200+ display
  columns even at `COLUMNS=40`), so the terminal wrapped it into a ragged,
  flush-left block with no visual boundary between sessions — and the
  highest-value line (why a session needs you) was buried at the very end of
  that block. Rendering is now measured/truncated to the detected width
  (new `--width`, else the live terminal width, else `$COLUMNS`, else 80):
  fields drop lowest-value-first (model, then branch/`#id`, then cwd) as the
  pane narrows, cwd tail-truncates to keep the leaf dir, a blocked reason is
  always shown (inline, or on its own clearly indented line when it can't
  fit), the counts header switches to compact chips below 60 cols instead of
  wrapping mid-phrase, and the idle `✓` icon is padded so every group's names
  line up in the same column.
- `resume` now honors a session's recorded custom tmux socket (`terminal.tmux`,
  the raw `$TMUX`) instead of always querying the default server. Sessions
  started under a non-default socket (`tmux -L`/`-S`, or a default socket that
  no longer exists after a reboot) now resolve and relaunch on the right
  server via `tmux -S <path>`, instead of silently failing pane resolution and
  falling back to copying the resume command.
