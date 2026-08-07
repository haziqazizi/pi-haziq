# Approved pi-haziq contract

This is the durable reconciliation of the package decisions approved in Pi sessions `019f9971-a52a-7531-8b81-b7b664a13070` and `019f9982-d92d-7f00-af3b-c55974c30ffc`.

## Required and implemented

| Approved outcome | Owning surface | Proof |
|---|---|---|
| One Git install composes the reviewed extension set. | `package.json` exact dependencies and `pi.extensions` entries | package and production-tarball smokes |
| Third-party versions are pinned and reviewed before updates. | `package.json`, `package-lock.json`, `AGENTS.md` | TypeScript/package tests and production audit |
| Multi-agent work uses Fabric agents and the full Fabric skill set (`fabric-guide` router); mesh stays off; Dynamic Workflows are not packaged. | Fabric pin, skill allowlist, `APPEND_SYSTEM.md` | manifest and package smokes |
| Monty long-run helpers (verification loop, supervisor, reason-harness, invisible-continue, autoresearch, queue-steer) are packaged; Kolt scheduled loop is not. | exact pins in `package.json` | package manifest tests |
| Reviewed upstream Fabric is bundled in full code mode; agents on, mesh off; all Fabric skills registered; only `fabric_exec` stays model-visible among tools. | `pi-fabric` pin, `fabric.json`, haziq-fabric | setup/doctor, captured inventory, package smokes |
| Opus/Anthropic-style sessions use delegated GPT compaction; Responses models use native compact. | `config/pi-better-compaction.json`, cohesion capability derivation | unit and live package tests |
| The user's default model remains a user setting. | configuration fragment deliberately omits default provider/model | setup idempotence test |
| Todo, Fabric agent correlation, workflow, loop, MCP, compaction, service tier, tool-call repair, models, and Herdr share bounded correlation and diagnostics. | `extensions/haziq-cohesion.ts`, compatibility wrappers, and bundled `pi-tool-repair` | cohesion, trust, reload, Herdr, and package tests |
| Meridian refreshes dynamically and fails open to safe static models. | `extensions/haziq-meridian-refresh.ts` | Meridian unit, package, and live smokes |
| Machine and project trust boundaries remain intact. | MCP and service-tier wrappers | trust smoke |
| A Pi-readable package preamble checks revisions before/after updates and requires publication of authorized package changes. | `APPEND_SYSTEM.md` | packaged-file and live prompt proof |
| New machines can apply the approved non-secret configuration without a wrapper script or package-load side effect. | interactive `/cohesion setup` | setup unit test and live setup check |
| Existing changed files receive a key-only preview, stale-plan rejection, staged atomic replacement, and backups; provider/auth files are never touched. | `src/setup.ts` | setup unit and fault-injection tests |
| Machine-wide `AGENTS.md` remains separate and additive. Project/CLI append overrides retain their content while cohesion injects the missing package contract. | global `APPEND_SYSTEM.md` link plus idempotent `before_agent_start` fallback | `/cohesion contract`, composition unit test, and live prompt proof |
| Herdr remains externally managed and optional. | cohesion only observes/reports through Herdr's public CLI | Herdr failure and package smokes |

## Deliberate boundaries

These were discussed but explicitly not first-release requirements or would violate settled ownership boundaries:

- Provider credentials, `auth.json`, `models.json`, MCP authentication, sessions, trust decisions, caches, and machine inventories remain local and are never synchronized through this public package.
- Pi's managed Git clone is never an authoring checkout.
- Package loading never silently rewrites machine configuration; `/cohesion setup` requires a user-visible preview and confirmation.
- Herdr pane-backed workflow workers and a dedicated workflow-monitor pane remain experimental/optional, not package prerequisites.
- Mesh stays off by default; Fabric swarm skill is present but full mesh coordination stays off until explicitly enabled.
- Prefer one orchestration path per job (agents vs fabric-workflow vs council/fusion).
- Dynamic Workflows and Nico Bailon `pi-subagents` are not packaged.
- Cohesion does not invent provider-switch, workflow-progress, artifact, or task-loop semantics when an owning extension exposes no stable public event. It observes public Pi hooks and pinned compatibility seams instead.
- Cohesion does not complete todos automatically. A delivered workflow must be verified at a faithful surface first.
- Fabric's standalone worker retains its exact `@earendil-works/pi-ai@0.84.1` runtime dependency; production proof rejects any additional bundled Pi core dependency or unreviewed pin change.
- Prompts and themes are package resource categories, not mandatory empty artifacts; none are shipped until a concrete prompt or theme is selected.
