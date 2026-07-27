# Build and proof evidence — upstream Fabric + sole Dynamic runtime

Parent run: `2026-07-27-upstream-fabric-dynamic-workflows`

## Implemented

- Replaced archived Fabric fork with reviewed upstream `pi-fabric@0.28.4`.
- Registered upstream `@quintinshaw/pi-dynamic-workflows@3.4.1`.
- Exposed only `designing-dynamic-workflows` and `fabric-exec` skills.
- Captured `workflow` and `workflow_control` behind Fabric.
- Added previewed setup policy disabling Fabric agents/mesh and Dynamic keyword routing.
- Added doctor drift checks and actionable `/cohesion setup` remediation.
- Landed and pinned doctrine revision `c0320dffdcd2ded349220f92ab23e12c390c6f50`.

## Ground-truth proof

- `npm run verify`: PASS — TypeScript, 46 unit tests, package smoke, trust smoke, Meridian smoke.
- `npm run smoke:production`: PASS — packed clean install, package/trust runtime smokes, no legacy Pi core copies.
- `npm run audit:production`: PASS — only reviewed stale GHSA metadata through MCP SDK; patched Hono 1.19.15 installed.
- Installed doctrine `scripts/check.mjs`: PASS.
- `git diff --cached --check`: PASS.
- Real foreground Dynamic subagent through captured `extensions.workflow`: `DYNAMIC_CANARY_OK`.
- Real background Dynamic subagent: active status observed, captured control stop observed, zero extension errors.
- Fabric `agents.run` under approved config: denied with `Agents are disabled in Fabric configuration`; zero run artifacts.
- Exact upstream Dynamic 3.4.1 release gate: PASS, 1,150 tests including pause/resume, reload reconfiguration, cold-start recovery/stop/resume, journal replay, concurrency, worktrees, and control tool lifecycle.

## Limits

- Candidate integration did not duplicate upstream’s entire cold-start fault suite; the exact pinned upstream release suite is the authoritative proof for those dependency-owned semantics.
- No credentials, provider headers, auth stores, private MCP configuration, sessions, or machine inventory were persisted.
