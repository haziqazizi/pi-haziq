# pi-haziq contribution rules

`pi-haziq` is a public Pi package. Extensions run with the installing user's full permissions.

- Never commit secrets, provider credentials, auth stores, private MCP configuration, session transcripts, or machine inventories.
- Pin every third-party extension version. Review updates before changing a pin.
- Load one copy of each third-party package. A bundled copy and standalone Pi install must not coexist after migration.
- `extensions/haziq-cohesion.ts` coordinates package owners through public Pi hooks and namespaced events. It must not reimplement provider, workflow, todo, loop, MCP, or compaction algorithms.
- Missing optional integrations must fail open with visible degraded diagnostics.
- Persist only correlation metadata. Never persist arbitrary tool inputs, MCP payloads, provider headers, or model transcripts.
- Keep Herdr optional. Do not vendor or edit Herdr's managed `herdr-agent-state.ts` integration.
- Prove package loading, reload behavior, and cross-extension seams before merging.
