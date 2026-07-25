# pi-haziq

A cohesive, opinionated [Pi](https://pi.dev) package composed from reviewed third-party extensions and first-party integration hooks.

> Early development. Do not install this package alongside standalone copies of its bundled extensions; duplicate tools and lifecycle handlers may be registered.

## Goals

- Preserve the user's chosen default model rather than letting an extension dictate it.
- Use native `/responses/compact` for Responses-family sessions.
- Delegate Anthropic-style text compaction to `tokenmaxxing/gpt-5.6-sol`.
- Correlate todo tasks, dynamic workflows, loops, MCP calls, compaction, and artifacts through versioned Pi events.
- Enrich Herdr panes when `HERDR_ENV=1` without bundling or replacing Herdr's managed Pi integration.
- Fail open with visible diagnostics when an optional integration is unavailable.

## Bundled extensions

| Package | Pin | Responsibility |
|---|---:|---|
| `pi-multi-pass` | 1.3.0 | Subscription pools and provider fallback |
| `@koltmcbride/pi-loop` | 0.2.0 | Scheduled, event, and self-paced loops |
| `@juicesharp/rpiv-todo` | 2.1.0 | Durable task graph and overlay |
| `pi-openai-service-tier` | 0.1.4 | OpenAI priority service tier |
| `pi-image-preview` | 0.1.5 | Inline image rendering |
| `pi-mcp-adapter` | 2.14.0 | MCP gateway and server tools |
| `@lll9p/pi-better-compaction` | 0.2.1 | Native Responses compact plus delegated fallback |
| `@quintinshaw/pi-dynamic-workflows` | 3.4.1 | Journaled multi-agent workflows |

`extensions/haziq-cohesion.ts` observes their public Pi surfaces and emits normalized `haziq:*` lifecycle events. It does not reimplement their algorithms.

`extensions/haziq-loop.ts` is a compatibility wrapper around pi-loop 0.2.0. It preserves upstream behavior while releasing shared event-bus subscriptions during `/reload`, preventing duplicate loop delivery across extension generations.

## Development

```bash
npm install
bin/test
```

Try in an isolated Pi configuration before touching a live setup:

```bash
HOME=/tmp/pi-haziq-home pi -e ./extensions/haziq-cohesion.ts
```

Install from Git:

```bash
pi install git:github.com/haziqazizi/pi-haziq
```

If the extensions are already installed individually, follow [`docs/migration.md`](docs/migration.md) to avoid loading duplicate copies.

## Diagnostics

Inside Pi:

```text
/cohesion
/cohesion doctor
/cohesion events
```

The doctor reports expected tools, the active model/API, compaction strategy, service-tier state, active todo/workflow correlation, Herdr availability, and machine configuration presence.

## Cross-model configuration

Templates live in [`config/`](config/):

- `settings.fragment.json`
- `pi-better-compaction.json`
- `pi-openai-service-tier.json`
- `workflow-model-tiers.json`

They intentionally contain no credentials. Applying them is an explicit migration step, not a package-load side effect.

## Herdr

Herdr owns `~/.pi/agent/extensions/herdr-agent-state.ts`. This package never vendors or edits it.

When running in Herdr, cohesion reports scoped metadata tokens for the active model, API, thinking level, todo, workflow, and compaction strategy. Background notifications are opt-in:

```bash
export HAZIQ_COHESION_HERDR_NOTIFICATIONS=1
```

A true pane-backed workflow agent backend remains experimental and will be attempted only after the core package seams pass end-to-end tests.

## Security

Pi extensions execute with the installing user's full permissions. Review every pin update. Never commit provider credentials, auth stores, private MCP configuration, sessions, or machine inventories to this repository.
