# pi-watch

A standalone terminal reader for [pi-presence](https://github.com/navbytes/pi-presence).
Renders a live, grouped list of every pi session: **needs-you → running → idle →
dormant**.

```sh
npx tsx packages/pi-watch/src/index.ts            # live TUI (repaints on change)
npx tsx packages/pi-watch/src/index.ts --once      # print once and exit
npx tsx packages/pi-watch/src/index.ts --json      # stream the view-model as JSON
npx tsx packages/pi-watch/src/index.ts --no-color  # disable ANSI color
npx tsx packages/pi-watch/src/index.ts --dir <path> # watch a specific live dir
```

It watches `<agentDir>/live/` (or `$PI_PRESENCE_LIVE_DIR`) via `fs.watch` plus a
periodic liveness reconcile, and garbage-collects long-dead session files. All
rendering logic lives in `src/render.ts` and is pure/unit-tested; the terminal
driver in `src/index.ts` is a thin wrapper.

Built entirely on [`@pi-presence/shared`](../shared) — the same reader contract
the Vee plugin uses.
