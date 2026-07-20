# Changelog

## Unreleased

### Fixed

- `--help`/`-h` now prints usage and exits 0; any unrecognized flag now prints
  a one-line error plus usage and exits 1. Previously both silently started
  the live TUI, which looked like a hang.
- Reading no longer deletes anything. `--once`, `--json`, the live TUI,
  `focus`, and `resume` used to silently unlink TTL-expired dormant state
  files as a side effect of just reading them; pruning is now opt-in
  (`{ prune: true }`) and only the explicit `gc` command sets it.
- The PID-reuse guard now works on macOS. It shelled out to `ps -o etimes=`
  (GNU/procps), which BSD `ps` on macOS rejects ("etimes: keyword not
  found"), so the start-time check silently no-op'd on the primary target
  platform. It now falls back to `ps -o etime=` (`[[dd-]hh:]mm:ss`) and parses
  that instead.
- `gc --ttl <duration>` lets you override the default 24h prune threshold,
  e.g. `90s`, `30m`, `2h`, `1d`, or a bare number of seconds. `--all` still
  prunes every dead session immediately, ignoring `--ttl`.
