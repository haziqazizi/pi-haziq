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
- Herdr remains optional and owns its managed Pi transport integration.

## Known transitive advisory

`npm audit --omit=dev` currently reports `GHSA-frvp-7c67-39w9` through `pi-mcp-adapter` → `@modelcontextprotocol/sdk` → `@hono/node-server@1.x`. The advisory concerns Windows encoded-backslash path traversal in Hono's static-file adapter. This package does not invoke that static-file adapter, and the deployed development host is Linux. The fixed Hono release is a new major outside the MCP SDK's declared range, so this package does not force an unsupported override. Re-evaluate when the MCP SDK updates its dependency range.
