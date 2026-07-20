# Changelog

All notable changes to this repository are documented here. The published
`pi-presence` extension keeps its own changelog at
[`packages/pi-presence/CHANGELOG.md`](packages/pi-presence/CHANGELOG.md); its
`## <version>` sections become the GitHub Release notes (see
`scripts/changelog-section.mjs`).

## 0.2.0

Verified end-to-end against real pi 0.79.2 (live sessions, not mocks).

### Fixed

- Extension loads on pi 0.79.2 (a 0.80.10-only import crashed every session).
- Sessions now actually transition to `idle` (the old code listened for an
  event that doesn't exist in pi's extension API) and `/name` renames
  propagate to the state file.
- Terminal titles go through pi's sanctioned `ctx.ui.setTitle` (raw-OSC kept
  only as a fallback); project settings are gated on `ctx.isProjectTrusted()`.
- Reader: `--help`/unknown-flag handling, read commands no longer silently
  delete aged state files (pruning is `gc`-only), macOS PID-reuse detection
  works (BSD `ps` fallback), `gc --ttl <duration>`.
- Narrow panes: width-responsive TUI rendering with field-priority truncation.
- Vee plugin: resume opens the user's terminal (`PI_PRESENCE_TERMINAL` → the
  session's recorded terminal → Terminal.app), not hardcoded Terminal.app.

### Added

- Session pinning across all readers: `pin`/`unpin` CLI, 📌 TUI prefix,
  dedicated PINNED menubar section, gc protection, ghost rows for pinned
  sessions whose files are gone.
- `resume <query>` subcommand, custom tmux socket support, live `--width`.
- Overhauled documentation (quickstart, honest hero, verified herdr contract).

## 0.1.1 / 0.1.0

### Added

- Initial monorepo scaffold with four workspaces:
  - `pi-presence` — the published pi extension (state files, self-labeling
    terminal tabs, cooperative `herdr:blocked` consumer, optional
    permission-gate producer, optional desktop notifications).
  - `@pi-presence/shared` — the pi-free reader library (schema, liveness,
    watch/reconcile, view model, RFC 6902 JSON Patch, terminal focus).
  - `pi-watch` — a standalone terminal reader over the shared library.
  - `@pi-presence/vee-plugin` — a Vee / xbar / SwiftBar menu-bar plugin (a single
    copyable script that renders `pi-presence-watch --once --json`).
