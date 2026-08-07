# pi-haziq contribution rules

`pi-haziq` is a public Pi package. Extensions run with the installing user's full permissions.

- Never commit secrets, provider credentials, auth stores, private MCP configuration, session transcripts, or machine inventories.
- Pin every third-party extension version. Review updates before changing a pin.
- Load one copy of each third-party package. A bundled copy and standalone Pi install must not coexist after migration.
- `extensions/haziq-cohesion.ts` coordinates package owners through public Pi hooks and namespaced events. It must not reimplement provider, workflow, todo, loop, MCP, or compaction algorithms.
- Missing optional integrations must fail open with visible degraded diagnostics.
- Persist only correlation metadata. Never persist arbitrary tool inputs, MCP payloads, provider headers, or model transcripts.
- Herdr is optional. When `HERDR_ENV=1` and the CLI is present, setup may run `herdr integration install pi`. Do not vendor or edit Herdr's managed `herdr-agent-state.ts`. Default Fabric agent transport is `process`.
- `APPEND_SYSTEM.md` is the portable Pi operating contract. Keep it additive to machine/project `AGENTS.md`, instruction-driven, and free of machine assumptions or secrets.
- `/cohesion setup` may touch only the documented non-secret settings/config targets and the global `APPEND_SYSTEM.md` link. It must show a key-only preview, confirm, take an exclusive setup lock, reject stale plans, stage atomic per-file replacements, back up updates, preserve the chosen default model and package list, and remain idempotent.
- Never edit Pi's managed package clone. Authorized durable changes must be proven and published through a PR before being called complete.
- Prove package loading, appended-prompt loading, setup idempotence, reload behavior, and cross-extension seams before merging.
