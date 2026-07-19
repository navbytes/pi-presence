# pi-presence

Ambient session-status for the [pi coding agent](https://pi.dev): per-session
state files, self-labeling terminal tabs, and a cooperative "needs-you" state —
so a menubar or TUI reader can show every session at a glance.

## Install

```sh
pi install npm:pi-presence
```

Ships TypeScript loaded by pi's `jiti` — no build step. On the next session
start you get a self-labeling tab and a state file at
`<agentDir>/live/<session-id>.json`.

## What it does

- **State files.** Atomically writes `working` / `blocked` / `idle` per session
  on every transition, with a terminal-correlation snapshot for click-to-focus.
- **Self-labeling tabs.** Emits an OSC 0/2 title (guarded on `tui` + TTY,
  sanitized against title injection).
- **Needs-you.** Consumes the cooperative `herdr:blocked` event (ref-counted).
- **Permission gate (optional).** A bundled producer that raises `herdr:blocked`
  around a confirmation for risky shell commands. Enable with
  `"extensions": ["./extensions/index.ts", "+permission-gate/index.ts"]`.
- **Notifications (optional).** Desktop alerts on `blocked` and
  long-run-finished transitions (macOS `osascript`).

## Settings (`settings.json` → `pi-presence`)

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `title` | `true` | Emit the terminal tab title (TUI + TTY only). |
| `titleFormat` | `"{icon} {name} · {state}"` | Placeholders: `{icon} {name} {state} {cwd} {branch}`. |
| `notify` | `false` | Desktop notifications. |
| `idleDebounceMs` | `250` | Debounce before `agent_settled` → `idle`. |
| `retryGraceMs` | `2500` | Re-check delay when a settle fires mid-retry. |
| `notifyThresholdMs` | `10000` | Min working time before a "finished" notification. |

See the [repository README](https://github.com/navbytes/pi-presence#readme) for
the full state schema and the `herdr:blocked` contract.

## License

[MIT](LICENSE)
