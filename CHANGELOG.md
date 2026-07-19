# Changelog

All notable changes to this repository are documented here. The published
`pi-presence` extension keeps its own changelog at
[`packages/pi-presence/CHANGELOG.md`](packages/pi-presence/CHANGELOG.md); its
`## <version>` sections become the GitHub Release notes (see
`scripts/changelog-section.mjs`).

## Unreleased

### Added

- Initial monorepo scaffold with four workspaces:
  - `pi-presence` — the published pi extension (state files, self-labeling
    terminal tabs, cooperative `herdr:blocked` consumer, optional
    permission-gate producer, optional desktop notifications).
  - `@pi-presence/shared` — the pi-free reader library (schema, liveness,
    watch/reconcile, view model, RFC 6902 JSON Patch, terminal focus).
  - `pi-watch` — a standalone terminal reader over the shared library.
  - `vee-pi-presence` — a Vee menubar plugin (JSON-RPC + JSON Patch over stdio).
