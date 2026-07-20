# pi-presence

Ambient session-status for the [pi coding agent](https://pi.dev). This extension
gives every pi session a live status — **needs-you / running / idle / dormant** —
by writing a small state file on each transition and self-labeling its terminal
tab, so a menu-bar or TUI [reader](https://www.npmjs.com/package/pi-presence-watch)
can show every session at a glance.

[![npm](https://img.shields.io/npm/v/pi-presence?color=cb3837&logo=npm)](https://www.npmjs.com/package/pi-presence)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/navbytes/pi-presence/blob/main/LICENSE)

![pi-presence-watch grouping pi sessions by needs-you / running / idle / dormant.](https://raw.githubusercontent.com/navbytes/pi-presence/main/assets/demo.png)

## Install

```sh
pi install npm:pi-presence
```

Requires pi ≥ 0.78.1 (live-tested on 0.79.2). No build step — pi loads the
shipped TypeScript with `jiti`. On your next session start you get a
self-labeling tab and a state file at `<agentDir>/live/<session-id>.json`.

## What it does

- **State files.** Atomically writes `working` / `blocked` / `idle` per session
  on every transition, with a terminal-correlation snapshot for click-to-focus.
- **Self-labeling tabs.** Sets the tab title via pi's `ctx.ui.setTitle` where
  available, falling back to a guarded, sanitized OSC write (`tui` + TTY only) on
  older pi versions.
- **Needs-you.** Consumes the cooperative `herdr:blocked` event (ref-counted), so
  it interoperates with [herdr](https://github.com/ogulcancelik/herdr) and any
  extension that raises the same event.
- **Permission gate (optional).** A bundled producer that raises `herdr:blocked`
  around a confirmation for risky shell commands. Enable with
  `"extensions": ["./extensions/index.ts", "+permission-gate/index.ts"]`.
- **Notifications (optional).** Desktop alerts on `blocked` and
  long-run-finished transitions (macOS).

## Settings (`settings.json` → `pi-presence`)

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `title` | `true` | Self-label the terminal tab (TUI only). |
| `titleFormat` | `"{icon} {name} · {state}"` | Placeholders: `{icon} {name} {state} {cwd} {branch}`. |
| `notify` | `false` | Desktop notifications. |
| `idleDebounceMs` | `250` | Debounce after `agent_end` before settling to `idle`. |
| `retryGraceMs` | `2500` | Re-check delay when a settle fires but the agent isn't idle yet. |
| `notifyThresholdMs` | `10000` | Min working time before a "finished" notification. |

A trusted project's `.pi/settings.json` overrides these per key; a mistyped value
falls back to its default with a one-line stderr warning.

See the [repository README](https://github.com/navbytes/pi-presence#readme) for
the full state schema, the reader CLI, and the verified `herdr:blocked` contract.

## License

[MIT](https://github.com/navbytes/pi-presence/blob/main/LICENSE)
