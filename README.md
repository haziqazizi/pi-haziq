# pi-haziq

A cohesive, opinionated [Pi](https://pi.dev) package composed from reviewed third-party extensions and first-party integration hooks.

> Early development. Do not install this package alongside standalone copies of its packaged extensions. Duplicate tools and lifecycle handlers can be registered.

## Goals

- Preserve the user's chosen default model rather than letting an extension dictate it.
- Use native `/responses/compact` for Responses-family sessions.
- Delegate Anthropic-style text compaction to `tokenmaxxing/gpt-5.6-sol`.
- Refresh Meridian's live model catalog while preserving conservative local capabilities when the endpoint lists IDs only.
- Route casual child agents through Fabric `agents.*` and fleet orchestration through Dynamic Workflows.
- Correlate todo tasks, named subagents, dynamic workflows, loops, MCP calls, compaction, and artifacts through versioned Pi events.
- Enrich Herdr panes when `HERDR_ENV=1` without bundling or replacing Herdr's managed Pi integration.
- Fail open with visible diagnostics when an optional integration is unavailable.
- Keep every Pi session on the reviewed package revision through an instruction-driven `APPEND_SYSTEM.md` contract.
- Apply approved non-secret configuration through an explicit, previewed, and reversible `/cohesion setup` command.

## Pinned package components

| Package | Pin | Responsibility |
|---|---:|---|
| `pi-multi-pass` | 1.3.0 | Subscription pools and provider fallback |
| `@monotykamary/pi-loop` | 0.1.17 | Verification loop (multi-modal verify-before-done) |
| `@monotykamary/pi-supervisor` | 0.5.13 | Outcome supervision / steering |
| `pi-reason-harness` | 1.0.7 | Iterate → verify → improve reasoning harness |
| `pi-invisible-continue` | 0.3.6 | Continue agent turns without a visible user prompt |
| `pi-autoresearch-harness` | 1.0.4 | Autonomous experiment loops with worktrees |
| `@tmustier/pi-queue-steer` (Monty pin) | ff75545 | Visible follow-up queue and steer |
| `@juicesharp/rpiv-todo` | 2.1.0 | Durable task graph and overlay |
| `pi-openai-service-tier` | 0.1.4 | OpenAI priority service tier |
| `pi-tool-repair` | 0.1.10 | Validate-then-repair for common LLM tool-call mistakes (Monty Kamary / monotykamary) |
| `pi-image-preview` | 0.1.5 | Inline image rendering |
| `pi-mcp-adapter` | 2.14.0 | MCP gateway and server tools |
| `@lll9p/pi-better-compaction` | 0.2.1 | Native Responses compact plus delegated fallback |
| `pi-fabric` | 0.40.1 | Upstream deterministic host-tool runtime; agents and mesh disabled; only `fabric-exec` advertised |
| `pi-web-access` | 0.15.0 | Web search and content fetching for pages, PDFs, GitHub repositories, and videos |
| `pi-agent-browser-native` | 0.2.72 | Browser automation for interactive pages, JavaScript-heavy pages, and visual checks |

Fabric's separate worker process intentionally carries its reviewed `@earendil-works/pi-ai@0.84.1` runtime dependency; upstream's package-manifest test rejects moving it to a host peer because the standalone worker imports it directly. Production smoke pins that sole core-runtime exception and rejects any expansion.

`extensions/haziq-cohesion.ts` observes their public Pi surfaces and emits normalized `haziq:*` lifecycle events. It does not reimplement their algorithms. Multi-agent work uses Fabric agents and user-invoked Fabric skills (`/skill:fabric-guide` router). Dynamic Workflows are not packaged. The package contract in `APPEND_SYSTEM.md` is authoritative. Quintin's `workflow-authoring` and `workflow-patterns` files remain bundled as runtime-owned references but are not separately advertised to the model; `designing-dynamic-workflows` loads the relevant one only when needed. Fabric's advanced skills are likewise not registered.

This package requires Node.js 24 or newer because Fabric's sandbox runtime does.

Compatibility wrappers preserve upstream behavior while closing integration seams:

- `extensions/haziq-fabric.ts` keeps Fabric's advanced skills out of automatic discovery, preserves only the package-allowlisted `fabric-exec` skill, and emits a names-only captured-tool inventory so cohesion can verify health without exposing schemas.
- `extensions/haziq-meridian-refresh.ts` attaches Pi's `refreshModels` hook to a globally configured Meridian provider. ID-only catalogs filter the trusted static models; bounded capability metadata can update limits or add models. Offline, malformed, empty, duplicate, and unreachable catalogs retain the static last-known-good list. Credentials and response bodies are never logged or persisted.
- `extensions/haziq-mcp.ts` delays MCP configuration until `session_start` and excludes project MCP sources unless Pi marks the project trusted, preventing untrusted eager stdio execution.
- `extensions/haziq-service-tier.ts` prevents untrusted project configuration from changing request tiers or allow-lists; trusted projects retain normal project-over-global behavior. Unsupported-model tier warnings stay out of the footer (details remain in `/openai-tier status` and notifies).
- `pi-tool-repair` repairs common open-model tool argument mistakes before execution (null optionals, stringified arrays, field aliases, root bare strings, Kimi anchor bleed). Grammar-leak recovery stays opt-in via its own config.
- Fabric agents are enabled; **all Fabric skills are registered** (including `fabric-guide` router). Mesh stays off by default.
- Dynamic Workflows are **not** packaged.
- Monty `/loop`, supervisor, reason-harness, invisible-continue, autoresearch, and queue-steer remain packaged.
- Footer status stays quiet when healthy: cohesion only publishes when degraded or a workflow is active. Optional full footer packages such as `pi-footer` remain user-installed; this package does not call `setFooter`.

## Development

```bash
npm install
bin/test
```

Try in an isolated Pi configuration before touching a live setup:

```bash
HOME=/tmp/pi-haziq-home pi -e ./extensions/haziq-cohesion.ts
```

## Install and bootstrap

Install once from Git:

```bash
pi install git:github.com/haziqazizi/pi-haziq
```

Start Pi and run:

```text
/cohesion setup
/reload
/cohesion doctor
/cohesion contract
```

`/cohesion setup` previews its work and asks before changing anything. It:

- links Pi's global `APPEND_SYSTEM.md` (under `getAgentDir()`) to the package-owned [`APPEND_SYSTEM.md`](APPEND_SYSTEM.md), preserving the separate machine-wide `AGENTS.md`;
- merges the approved model scope and compaction settings without changing the user's default provider/model or package list;
- writes each pinned owner's configuration where that owner actually reads it (some currently hardcode `~/.pi` even when Pi's agent directory is overridden);
- shows a key-only, value-redacted preview; takes an exclusive setup lock; repeatedly rejects stale targets; stages complete replacements; atomically replaces each target; and backs up every existing file it changes;
- never reads or writes provider credentials, `auth.json`, `models.json`, MCP authentication, sessions, trust decisions, or caches.

On future sessions, the appended policy instructs the agent to run:

```bash
pi update --extension git:github.com/haziqazizi/pi-haziq
```

The policy records the installed Git revision before and after the update instead of trusting Pi's generic status text. If the revision changed, reload before continuing so one Pi runtime never mixes extension generations. Offline or unreadable package state is reported as not verified. This is intentionally instruction-driven rather than a shell wrapper: the first process loads the installed revision, then its first substantive agent turn checks for updates.

Pi itself chooses a trusted project `.pi/APPEND_SYSTEM.md` or an explicit `--append-system-prompt` instead of composing it with the global file. Cohesion therefore uses the package file as the single source of truth and appends the exact complete contract through `before_agent_start` only when Pi's selected system prompt does not already contain it. Project instructions remain present; heading-only collisions cannot suppress the contract; and the package contract does not duplicate across turns or reloads.

If the extensions are already installed individually, follow [`docs/migration.md`](docs/migration.md) to avoid loading duplicate copies. The reconciled approved contract and explicit non-goals are recorded in [`docs/approved-contract.md`](docs/approved-contract.md).

## Diagnostics

Inside Pi:

```text
/cohesion
/cohesion doctor
/cohesion events
/cohesion contract
/cohesion setup check
/cohesion setup
```

The doctor reports expected captured tools, dual-subagent runtime configuration drift, the active model/API, compaction strategy, service-tier state, active todo/workflow correlation, Herdr availability, machine configuration presence, and the last Meridian refresh result with published/capability model counts and timestamp. Configuration drift is repaired explicitly with `/cohesion setup`, followed by `/reload`.

Pi refreshes dynamic model providers during online startup, model-picker refresh, and `pi update`. Meridian discovery reads the global `~/.pi/agent/models.json` provider configuration only; project files cannot change its endpoint or credentials. Current Meridian `/v1/models` responses list model IDs, so local `contextWindow` and `maxTokens` values remain authoritative until Meridian publishes validated capability fields.

## Cross-model configuration

Templates live in [`config/`](config/):

- `settings.fragment.json`
- `pi-better-compaction.json`
- `pi-openai-service-tier.json`
- `workflow-model-tiers.json`
- `fabric.json`
- `workflow-settings.json`

They intentionally contain no credentials. Applying them through `/cohesion setup` is an explicit, confirmed migration step, never a package-load side effect.

## Herdr

Fabric agent transport defaults to `herdr`, so the `herdr` CLI from [herdr.dev](https://herdr.dev) is a package prerequisite. `/cohesion setup` checks for the binary and runs `herdr integration install pi` when needed. Herdr owns `~/.pi/agent/extensions/herdr-agent-state.ts`; this package never vendors or edits that file.

When running in Herdr, cohesion reports scoped metadata tokens for the active model, API, thinking level, todo, workflow, and compaction strategy. Background notifications are opt-in:

```bash
export HAZIQ_COHESION_HERDR_NOTIFICATIONS=1
```

A true pane-backed workflow agent backend remains experimental and is not part of the approved first-release contract.

## Authoring and synchronization

Never edit Pi's managed clone under `~/.pi/agent/git/`. Make changes in a normal source checkout or task worktree, run `bin/test` and the production audit, and publish a PR. Do not report an authorized package change complete while it exists only on one machine. Merge only with explicit authority and green evidence; then update the installed package, reload, and run `/cohesion doctor`.

## Security

Pi extensions execute with the installing user's full permissions. Review every pin update. Never commit provider credentials, auth stores, private MCP configuration, sessions, or machine inventories to this repository.
