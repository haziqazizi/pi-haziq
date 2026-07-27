# Upstream Fabric + Dynamic Workflows cutover

Status: active — establishing baselines and contracts.
Context: [2026-07-27-upstream-fabric-dynamic-workflows-context.md](../../skill-outputs/me-lfg/2026-07-27-upstream-fabric-dynamic-workflows-context.md)

## Acceptance criteria

| ID | Criterion | State | Proof |
|---|---|---|---|
| AC1 | pi-haziq pins reviewed upstream pi-fabric and no longer resolves the archived fork. | passing | manifest/lock audit + production tarball install |
| AC2 | Upstream Dynamic Workflows extension is loaded; its runtime skills remain hidden. | passing | package manifest + live skill catalog |
| AC3 | Only fabric-exec is exposed from Fabric skills; workflow tools are captured as extensions.workflow/control. | passing | manifest + live Fabric catalog |
| AC4 | Fabric agents and mesh are disabled and doctor detects drift. | passing | setup tests + live denial probes |
| AC5 | designing-dynamic-workflows routes all subagents to Dynamic and direct work to Fabric. | passing | skill checks + routing fixtures |
| AC6 | Background launch, follow-up, control, pause/resume, reload/restart, and cleanup work in real Pi. | passing | isolated real Pi smoke |
| AC7 | Setup remains previewed, atomic, stale-safe, backed up, idempotent, and secret-free. | passing | fault-injection setup suite |
| AC8 | Complete proof gates, production audit, independent review, PR checks, merges, installed update, reload, doctor, and canary are green. | active | command/PR/canary evidence |

## Progress

- Done: doctrine PR #2 merged; upstream pins integrated; runtime policy/setup/doctor implemented; deterministic, production, real canary, upstream release, and independent review gates pass.
- In progress: publish and land the pi-haziq PR.
- Next: update installed package, reload, apply setup, run doctor, and observe a bounded canary.

## Decision log

- Use upstream runtimes; rejected maintaining either runtime fork because integration/configuration satisfies the objective.
- Dynamic Workflows is the sole subagent owner; rejected dual orchestration planes.
- Fabric remains the single model-visible execution tool; Dynamic tools are captured.
- Hide runtime-specific skills; keep one visible doctrine router plus fabric-exec.
- Retire Fabric actors, advisor/supervisor, swarm, RLM, handoff, Prewalk, and advanced agent patterns.

## Validation

- Doctrine: `npm test`.
- pi-haziq focused: `npm test`.
- pi-haziq complete: `npm run verify:full`.
- Clean production package and real Pi smoke per task #7.

## Interruption state

- Deadline signal: unavailable; checkpoint after each verified logical unit.
- Active resources: two Git worktrees; owner main; remove only after merged and installed cutover.
- Resume gate: re-read this plan and context, validate branches and todo state, rerun the latest named proof.
- First resume action: inspect current diffs and task #1 status.

## Blockers

None.
