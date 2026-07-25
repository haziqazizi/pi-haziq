# Security

Pi extensions execute with the installing user's full permissions. Treat every dependency update as executable-code review.

## Reporting

Report vulnerabilities privately to the repository owner. Do not include credentials, auth files, session transcripts, or private MCP configuration in an issue.

## Package policy

- No secrets, provider auth, MCP credentials, or session data in the repository.
- Exact third-party extension pins and a committed lockfile.
- Production installs omit development dependencies.
- Legacy `@mariozechner/pi-*` peer packages are not installed; Pi supplies compatibility aliases from its bundled runtime.
- Cohesion persists correlation metadata only, never arbitrary tool inputs or provider payloads.
- Project MCP and service-tier configuration is ignored until Pi marks the project trusted. Global user configuration remains available.
- Herdr remains optional and owns its managed Pi transport integration.

## Transitive advisory verification

GitHub's authoritative record for `GHSA-frvp-7c67-39w9` defines two vulnerable ranges for `@hono/node-server`: `<1.19.15` and `>=2.0.0 <2.0.5`. Release `1.19.15` is the patched 1.x backport and remains compatible with the MCP SDK's declared `^1.19.9` range.

This package pins `@hono/node-server` to `1.19.15` and behaviorally tests its encoded-backslash rejection. npm's audit endpoint currently flattens the two ranges to `<2.0.5`, so raw `npm audit --omit=dev` may still report the patched release. `npm run audit:production` fails on every finding except that exact stale-metadata chain, and only permits it while the installed release and regression test remain pinned.
