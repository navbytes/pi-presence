# @pi-presence/shared

The zero-pi-dependency reader library behind
[pi-presence](https://github.com/navbytes/pi-presence#readme). It turns the
`live/` state-file directory into a grouped, liveness-checked view model.
Consumed by `pi-presence-watch` and any standalone reader — it never imports pi,
so non-pi hosts can use it without pulling the pi peer packages.

## Exports

- **schema** — the canonical `StateFile` type, `SCHEMA_VERSION`, and forward-compat guards. (Byte-identical to the extension's pinned copy; enforced in CI.)
- **paths** — live-directory resolution (`PI_PRESENCE_LIVE_DIR` / `PI_CODING_AGENT_DIR` / `~/.pi/agent`).
- **liveness** — `isAlive(pid, startTime)` with PID-reuse detection.
- **reconcile** — `loadAllAndReconcile(dir)`: parse, validate, and liveness-annotate (with an optional TTL prune of long-dead files).
- **view-model** — `buildViewModel(snapshots)`: grouped (needs-you / running / idle / dormant), sorted, counted.
- **watch** — `watchLive(dir, onChange)`: `fs.watch` + periodic liveness reconcile.
- **json-patch** — RFC 6902 `compare` / `applyPatch` for incremental UI updates.
- **focus** — build/execute terminal focus commands (iTerm2 / Ghostty / Terminal.app / tmux) and resume commands.

Private to the workspace; not published to npm.
