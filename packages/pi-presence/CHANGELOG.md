# Changelog

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
