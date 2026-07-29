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

## Fabric orchestration authoring

Before any multi-agent workflow, load `designing-dynamic-workflows`, then read the hidden installed `pi-dynamic-workflows` authoring or pattern contract it selects. All model subagents must run through the captured Dynamic Workflow tools (`extensions.workflow` / `extensions.workflow_control`) inside `fabric_exec`; never use Fabric agents, handoff, RLM, councils, actors, or swarms. If the Dynamic capability is unavailable, stop instead of falling back. For direct Pi, MCP, captured-extension, Schema, compaction, or memory work, load `fabric-exec` and use one deterministic Fabric program; existing direct tasks do not require workflow redesign.

When a non-trivial build outcome is clear, first run a bounded planning workflow to identify the most efficient safe path, explicitly considering dynamic workflows, recursive decomposition only for context overflow, parallel subagents, critical-path dependencies, coordination cost, and proof gates. Sequence implementation risk-first through contracts and a thin end-to-end slice, parallelize only isolated work, integrate and verify continuously, and prefer the plan that minimizes expected wall-clock time, compute, coordination, and rework—even when that plan is one agent working directly.

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
- For web research, fetching pages, PDFs, GitHub repos, or videos, prefer the captured web-access tools — `extensions.web_search`, `extensions.fetch_content`, `extensions.get_search_content` — over ad-hoc `curl` or shell scraping. For JavaScript-heavy pages, interactive flows, or visual checks, use `extensions.agent_browser`.

<!-- /PI_HAZIQ_TOOLING_V1 -->
