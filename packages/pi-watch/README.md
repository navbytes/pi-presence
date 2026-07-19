# pi-presence-watch

A standalone terminal reader for [pi-presence](https://github.com/navbytes/pi-presence).
Renders a live, grouped list of every pi session — **needs-you → running → idle →
dormant** — and can focus a session's terminal or prune dead ones.

```sh
npx pi-presence-watch                 # live TUI (repaints on change)
npx pi-presence-watch --once           # print once and exit
npx pi-presence-watch --json           # stream the view model as JSON
npx pi-presence-watch --no-color       # disable ANSI color
npx pi-presence-watch --dir <path>     # watch a specific live dir

npx pi-presence-watch focus <query>    # focus a session's terminal, or copy its
                                       # resume command to the clipboard as a fallback.
                                       # <query> matches id / short-id / name / cwd.
npx pi-presence-watch gc [--all]       # prune dormant state files (past the 24h
                                       # TTL, or all dead with --all)
```

It watches `<agentDir>/live/` (or `$PI_PRESENCE_LIVE_DIR`) via `fs.watch` plus a
periodic liveness reconcile, and garbage-collects long-dead session files.

Ships as a single bundled, zero-dependency CLI (built with esbuild); the
`@pi-presence/shared` reader library is inlined. All logic is unit-tested; the
terminal driver in `src/index.ts` is a thin wrapper.
