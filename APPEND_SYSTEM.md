# pi-haziq operating contract

<!-- PI_HAZIQ_CONTRACT_V1 -->

Apply this contract only to Pi and `haziqazizi/pi-haziq`. Machine-wide and project `AGENTS.md` instructions remain authoritative and additive.

## Session synchronization

Once per Pi session, before non-trivial work:

1. Resolve the installed checkout for `git:github.com/haziqazizi/pi-haziq` from Pi's package state. Record its Git `HEAD` as `before`. Do not assume `~/.pi/agent` when `PI_CODING_AGENT_DIR` or `PI_PACKAGE_DIR` is set.
2. If `PI_OFFLINE` is enabled, or the installed checkout/revision cannot be read, report synchronization as **not verified** and do **not** run the update command. Continue with the installed revision only when the user's task does not require current package state.
3. Otherwise, while online with a readable `before` revision, run:

   ```bash
   pi update --extension git:github.com/haziqazizi/pi-haziq
   ```

4. Regardless of the update command's exit status, read the installed checkout's Git `HEAD` as `after`:
   - `before != after` → package files changed, even if dependency installation later failed. Stop before substantive work. Report the update result and tell the user to repair/update, then `/reload` (or restart Pi) before continuing.
   - `before == after` and update succeeded → package unchanged; continue.
   - `before == after` and update failed, or missing `after` → synchronization not verified; report the blocker.
5. Never treat Pi's generic `Updated` message as proof of a network check, and never continue with old loaded extensions and newly updated package files in the same runtime generation.
6. Treat `/cohesion doctor` as the package health check. If it reports missing non-secret setup, ask the user to run `/cohesion setup`; do not silently rewrite machine configuration.

This is an instruction-driven check. It does not run before Pi initially loads the installed package.

## New-machine setup

On a machine where the package is absent:

```bash
pi install git:github.com/haziqazizi/pi-haziq
```

Then start Pi, run `/cohesion setup`, approve its preview, and run `/reload`. Provider credentials, `auth.json`, `models.json`, MCP authentication, sessions, trust decisions, and machine inventories remain machine-local and must be provisioned separately through approved secret mechanisms.

Herdr is optional. When `HERDR_ENV=1`, verify that the Herdr-managed Pi integration is current through Herdr's supported integration command. Never vendor or edit `~/.pi/agent/extensions/herdr-agent-state.ts` from this package.

## Subagent package routing

This package ships two reviewed subagent surfaces. Choose one surface per job. Do not run both for the same work. Never use Fabric agents, handoff, RLM, councils, actors, or swarms.

### Use `pi-subagents` for casual delegation

Use Nico Bailon's `pi-subagents` when the parent only needs one or a few named roles, a short chain, or a small parallel fanout of known agent types.

Examples: one reviewer, one oracle second opinion, one scout, worker then reviewer, three parallel review lanes.

- Prefer plain-language delegation with builtin roles (`scout`, `researcher`, `planner`, `worker`, `reviewer`, `context-builder`, `oracle`, `delegate`).
- Call the captured tools through `fabric_exec` as `extensions.subagent` and, only for run-to-completion waits, `extensions.subagent_wait`.
- Load skill `pi-subagents` when the parent needs role choice, chain/parallel composition, or package constraints.
- Do not invent a Dynamic workflow script for these jobs.

### Use Dynamic Workflows for fleet orchestration

Use Quintin's `@quintinshaw/pi-dynamic-workflows` when the work needs code-mode orchestration, large fan-out, model-tier routing, journaled resume, worktree isolation, budgets, or multi-phase verify/judge loops.

Examples: codebase-wide audit, multi-stage research with verification, large parallel file fleet, resumable multi-phase orchestration.

- Before authoring, load `designing-dynamic-workflows`, then read the hidden installed `pi-dynamic-workflows` authoring or pattern contract it selects.
- Call the captured tools through `fabric_exec` as `extensions.workflow` and `extensions.workflow_control`.
- If the Dynamic capability is unavailable for a fleet job, stop instead of falling back to Fabric agents or inventing a second fleet plane.

### Direct non-subagent work

For direct Pi, MCP, captured-extension, Schema, compaction, or memory work, load `fabric-exec` and use one deterministic Fabric program. Existing direct tasks do not require subagent or workflow redesign.

When a non-trivial build outcome is clear, first run a bounded planning pass to identify the most efficient safe path, explicitly considering casual `pi-subagents` delegation, Dynamic Workflows for fleets, recursive decomposition only for context overflow, parallel subagents, critical-path dependencies, coordination cost, and proof gates. Sequence implementation risk-first through contracts and a thin end-to-end slice, parallelize only isolated work, integrate and verify continuously, and prefer the plan that minimizes expected wall-clock time, compute, coordination, and rework—even when that plan is one agent working directly.

## Authoring and publication

When changing `haziqazizi/pi-haziq`:

1. Work in a normal source checkout or task worktree. Never edit Pi's managed clone under `~/.pi/agent/git/`.
2. Follow the repository's `AGENTS.md`. Review every third-party pin because Pi extensions run with full user permissions.
3. Run the repository's complete proof gate and production audit before publication.
4. Do not report a package change complete while it exists only on one machine. Commit it and publish or update a pull request when authorized; merge only with explicit authority and green evidence.
5. After merge, update the installed package, reload Pi, and run `/cohesion doctor` against the merged revision.
6. Never commit or print credentials, provider headers, auth stores, private MCP configuration, session transcripts, caches, or machine inventories.

<!-- /PI_HAZIQ_CONTRACT_V1 -->

# Tooling discipline

<!-- PI_HAZIQ_TOOLING_V1 -->

These tools are captured by Fabric and may not appear in the model's tool list. Call them by ref inside a `fabric_exec` program; when a harness exposes them directly, call them directly. Resolve an unknown ref with `tools.search({ query })` instead of assuming a tool is unavailable.

- Track multi-step work with the captured todo tool. Create a task per step when the work starts (`extensions.todo({ action: 'create', subject, activeForm })`), move each to `in_progress` as it begins and `completed` as it finishes (`extensions.todo({ action: 'update', id, status })`), and keep the list current so progress survives compaction and stays visible mid-task. Batch todo calls into the same program as the work they describe rather than spending a round trip on bookkeeping alone.
- For casual named-role subagents, call `extensions.subagent` through `fabric_exec`. Use `extensions.subagent_wait` only for run-to-completion waits; do not poll.
- For fleet orchestration scripts, call `extensions.workflow` and `extensions.workflow_control` through `fabric_exec`.
- For web research, fetching pages, PDFs, GitHub repos, or videos, prefer the captured web-access tools — `extensions.web_search`, `extensions.fetch_content`, `extensions.get_search_content` — over ad-hoc `curl` or shell scraping. For JavaScript-heavy pages, interactive flows, or visual checks, use `extensions.agent_browser`.

<!-- /PI_HAZIQ_TOOLING_V1 -->
