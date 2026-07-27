# Land record — sole Dynamic subagent cutover

Status: complete.

## Landed changes

- Doctrine PR: `haziqazizi/designing-dynamic-workflows#2`, merge `c0320dffdcd2ded349220f92ab23e12c390c6f50`.
- Package PR: `haziqazizi/pi-haziq#16`, merge `629a7b84aa82232ca14bbf68ed9a2a7d88f56222`.
- Installed package advanced from `20c4a48f377a430ab2dca8fa69626810ff316643` to `629a7b84aa82232ca14bbf68ed9a2a7d88f56222` and was reloaded.

## Observation

- `/cohesion doctor`: healthy; 8/8 tools Fabric-captured; runtime config healthy; all six non-secret configuration targets present.
- Captured tools: `extensions.workflow` risk `agent`, `extensions.workflow_control` risk `execute`.
- Fabric config: full code mode on, agents off, mesh off, only `fabric_exec` visible.
- Dynamic keyword trigger: off.
- Installed background canary `installed-canary-ms3nkvfj-gzou1x`: completed, one agent done, exact result `INSTALLED_DYNAMIC_CANARY_OK`, 12,802 recorded tokens.
- Running workflows after observation: none.

## Rollback

Revert `pi-haziq` to the prior published revision, reload, restore one matching `/cohesion setup` backup set, then run doctor. No tripwire fired.
