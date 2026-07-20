# Changelog

## 0.2.0

### Fixed

- The extension now loads on pi 0.79.2 (and other versions whose runtime
  build doesn't re-export `CONFIG_DIR_NAME`): a missing export used to crash
  every session with `Failed to load extension ... "path" argument must be of
  type string`. Config/agent-dir resolution now falls back to pi's own
  defaults instead of failing.
- Sessions now actually reach `idle`. The idle transition was wired to an
  `agent_settled` event that pi never sends, so every interactive session
  stayed stuck at `working` forever; it's now driven by the real `agent_end`
  event.
- `/name` renames now propagate to the state file on the next transition.
  They were previously wired to a `session_info_changed` event that doesn't
  exist for extensions, so renames never showed up.
- The terminal tab title is now set via pi's own `ctx.ui.setTitle` API when
  available, falling back to the previous raw-escape-sequence write only on
  older pi versions that lack it.
- A project's `.pi/settings.json` is now only honored when the project is
  trusted, matching pi's guidance for reading project-local configuration.
- The state file is now removed at the end of every session (quit, reload,
  `/new`, `/resume`, fork), not just quit, so a stale file with a live pid can
  no longer linger after those commands.

## 0.1.1

Maintenance / version-alignment release — no functional changes to the extension
since 0.1.0. A Vee / xbar / SwiftBar menu-bar plugin is now available in the repo
(`packages/vee-plugin`) as a copyable script.

## 0.1.0

### Added

- Per-session state files written atomically to `<agentDir>/live/<id>.json` on
  every state transition (`working` / `blocked` / `idle`).
- Self-labeling terminal tab via OSC 0/2 title escapes, guarded on
  `ctx.mode === "tui"` and `process.stdout.isTTY`, with title sanitization.
- Terminal-correlation snapshot (iTerm2, Ghostty, Terminal.app, tmux) captured
  at session start for click-to-focus by readers.
- Cooperative `herdr:blocked` consumer (ref-counted) for the "needs-you" state.
- Optional bundled `permission-gate` extension that emits `herdr:blocked` around
  a confirmation for risky shell commands.
- Optional desktop notifications on `blocked` and long-run-finished transitions.
- Configurable via the `pi-presence` block of `settings.json`.
