# pi-presence — Vee menu-bar plugin

A [Vee](https://github.com/navbytes/vee) plugin (also xbar / SwiftBar compatible)
that shows every pi session in your macOS menu bar — **needs-you / running /
idle / dormant** — with click-to-focus.

It's a **single copyable script** ([`pi-presence.5s.ts`](./pi-presence.5s.ts)).
It renders the output of `pi-presence-watch --once --json` into the xbar menu
format, so all the reader logic (liveness, grouping, focus) is reused from the
published CLI rather than duplicated.

## Install

```sh
npm i -g pi-presence-watch     # the reader CLI this plugin renders + focuses with
```

Then copy the script into your Vee plugins folder and make it executable:

```sh
cp pi-presence.5s.ts "$HOME/Library/Application Support/Vee/plugins/"
chmod +x "$HOME/Library/Application Support/Vee/plugins/pi-presence.5s.ts"
```

Requires **Node 24+** (Vee runs `.ts` directly — no build step). The `5s` in the
filename is the refresh interval; rename it (e.g. `pi-presence.10s.ts`) to change
cadence.

## What you get

- **Menu-bar title:** `⛔<n>` (red) when sessions need you, `⚡<n>` when running, `✓` when calm.
- **Dropdown:** sessions grouped by state; each item shows name, short id, model/branch (tooltip), and a blocked reason when waiting.
- **Click a session → focus its terminal tab** (via `pi-presence-watch focus`, which falls back to copying the `pi --session …` resume command to the clipboard). Each session's submenu also has **Resume in Terminal** and **Open folder**.
- Declares its capabilities to Vee via `<vee.exec>` / `<vee.filter>` / `<vee.shortcut>` tags, and enables the searchable filter panel (⌘⇧P).

## Troubleshooting

GUI apps like Vee run with a minimal `PATH` that usually omits the npm global
bin, so the plugin resolves `pi-presence-watch` / `pi` to absolute paths itself
(it checks `$PI_PRESENCE_WATCH_BIN`, the directory of the Node running the
plugin, `$PATH`, and common install dirs like `/opt/homebrew/bin`).

If you still see **"pi-presence-watch not found"**, set the absolute path
explicitly: run `which pi-presence-watch`, then set `PI_PRESENCE_WATCH_BIN` to
that value in the plugin's settings (Vee reads the `<xbar.var>`), or export it in
the environment Vee launches from.
