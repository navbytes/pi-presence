# vee-pi-presence

A [Vee](https://) menubar plugin (reader adapter) for
[pi-presence](https://github.com/navbytes/pi-presence). It watches the live
directory and speaks newline-delimited JSON-RPC over stdio, emitting incremental
JSON Patch (RFC 6902) view updates and handling click-to-focus.

> **Assumption:** Vee has no public plugin API. `vee.plugin.json` and the
> `vee.*` bindings here are a best guess and must be reconciled against the real
> Vee interface. The stable, tested part is the stdio contract in `src/`, built
> on [`@pi-presence/shared`](../shared) — so the same reader also backs a
> standalone `NSStatusItem` app if Vee isn't ready.

## Protocol

Plugin → host (notifications):

- `presence/replace` — full view model on first render.
- `presence/patch` — RFC 6902 ops for subsequent changes (volatile fields like
  `generatedAt`/`ageMs` are stripped, so quiet ticks emit nothing).

Host → plugin (id'd requests):

- `presence/focus` `{ sessionId }` → focuses the terminal tab; replies
  `{ focused, strategy, resume }`.
- `presence/resume` `{ sessionId }` → replies with the resume command.

Frames are split only on `\n`; all diagnostics go to stderr.

## Run

```sh
npx tsx packages/vee-pi-presence/src/index.ts
```
