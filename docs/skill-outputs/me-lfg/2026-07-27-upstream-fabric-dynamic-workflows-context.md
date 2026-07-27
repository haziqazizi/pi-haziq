# LFG Run Context

```yaml
run_id: 2026-07-27-upstream-fabric-dynamic-workflows
objective: Migrate pi-haziq to upstream pi-fabric, register upstream pi-dynamic-workflows as the sole subagent runtime behind Fabric capture, update the design doctrine, prove the integration, publish PRs, merge when green, and cut over the installed Pi.
initiator: human
provenance:
  kind: direct_current_user
  source: current conversation turn requesting "Use the todo tool... LFG. Land all."
session_kind: autonomous
execution_status: complete
authorized_actions:
  - action: repo_edit
    targets: [haziqazizi/pi-haziq, haziqazizi/designing-dynamic-workflows]
  - action: commit
    targets: [feat/dynamic-workflows-cutover, feat/dynamic-workflows-routing]
  - action: publish_pr
    targets: [haziqazizi/pi-haziq, haziqazizi/designing-dynamic-workflows]
  - action: merge
    targets: [haziqazizi/pi-haziq, haziqazizi/designing-dynamic-workflows]
  - action: smoke
    targets: [isolated Pi configuration, installed pi-haziq]
  - action: observe
    targets: [installed pi-haziq canary]
parent_run_id: null
```

## Scope

- Repositories: `/code/pi-haziq/.worktrees/dynamic-workflows-cutover`, `/code/designing-dynamic-workflows/.worktrees/dynamic-workflows-routing`.
- Package target: `git:github.com/haziqazizi/pi-haziq`.
- Merge authority is limited to the two named PRs after current review and green proof.

## Limits and exclusions

- No force push, credential changes, provider/account mutation, customer messages, deployment, destructive data work, billing, or policy weakening.
- Never edit Pi-managed package clones.
- Never print or commit secrets, auth stores, sessions, MCP private config, or machine inventories.
- If package files change during installed update, reload before substantive use.

Created: 2026-07-27 UTC.
