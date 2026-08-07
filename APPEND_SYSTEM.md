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

Herdr is a **required runtime dependency** for the default Fabric agent transport. Install the `herdr` CLI from https://herdr.dev before or with package setup. `/cohesion setup` runs `herdr integration install pi` when the CLI is present; it never vendors or edits `~/.pi/agent/extensions/herdr-agent-state.ts` itself. When `HERDR_ENV=1`, cohesion also verifies the live pane integration.

## Multi-agent and Fabric skill routing

This package uses **Fabric** as the multi-agent plane. Dynamic Workflows are not packaged.

### Router

When unsure which advanced Fabric path to use, run **`/skill:fabric-guide`**. It only recommends a skill; it does not run it.

### Core path

- Normal coding: `fabric_exec` + skill `fabric-exec` as needed.
- Casual children: `agents.run` / `agents.spawn` / `agents.wait` inside `fabric_exec` (Fabric agents enabled; default transport `herdr` opens each child in a background Herdr tab).
- Mesh is **on** by default so ambient actors, supervisors, and swarm coordination can restore. Prefer `fabric-workflow` / agents for one-shot fan-out; use swarm when durable multi-actor work is required.

### User-invoked Fabric skills (all enabled)

| Need | Skill |
|---|---|
| Choose a path | `/skill:fabric-guide` |
| Finite fan-out + verify | `/skill:fabric-workflow` |
| Same-model role council | `/skill:fabric-council` |
| Multi-model panel + judge | `/skill:fabric-fusion` |
| Context too large | `/skill:fabric-rlm` |
| Evidence-gated file mutation | `/skill:fabric-schema` |
| Ambient peer advice | `/skill:fabric-advisor` |
| One measurable goal watcher | `/skill:fabric-supervisor` |
| Spec compliance until verified | `/skill:fabric-spec` |
| Advisor vs supervisor setup | `/skill:fabric-ambient` |
| Durable actor team | `/skill:fabric-swarm` (needs mesh if full swarm) |

### Outside Fabric (still packaged)

- Monty `/loop` / `start_loop` — verify-before-done on the main session.
- Monty `/supervise` — standalone outcome supervision.
- `todo` (rpiv-todo) — checklist overlay.
- Do **not** install Nico Bailon `pi-subagents`.

### Direct work

For ordinary Pi/MCP/tools work, use one `fabric_exec` program without children when that is enough.

When a non-trivial build outcome is clear, first run a bounded planning pass. Consider Fabric agents, Fabric workflow/council/fusion skills, recursive RLM only for context overflow, coordination cost, and proof gates. Prefer the plan that minimizes wall-clock time, compute, coordination, and rework.


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
- For casual child agents, call `agents.run` / `agents.spawn` inside `fabric_exec` (Fabric agents enabled).
- For verify-before-done task closure, use Monty `/loop` / `start_loop` (not a scheduled prompt timer).
- For fleet orchestration scripts, call `extensions.workflow` and `extensions.workflow_control` through `fabric_exec`.
- For web research, fetching pages, PDFs, GitHub repos, or videos, prefer the captured web-access tools — `extensions.web_search`, `extensions.fetch_content`, `extensions.get_search_content` — over ad-hoc `curl` or shell scraping. For JavaScript-heavy pages, interactive flows, or visual checks, use `extensions.agent_browser`.

<!-- /PI_HAZIQ_TOOLING_V1 -->
