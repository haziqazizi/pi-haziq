# QA report — sole Dynamic subagent cutover

Verdict: **PASS for PR publication**.

| Scenario | Risk | Result | Evidence |
|---|---|---|---|
| Upstream dependency and packed artifact | high | PASS | manifest/lock tests; production smoke |
| Visible skill surface | high | PASS | only doctrine + fabric-exec in package smoke |
| Dynamic tool capture | high | PASS | 8/8 captured inventory includes workflow/control |
| Hidden runtime skills | high | PASS | command/catalog assertions and production package |
| Fabric agent denial | fatal | PASS | real denial probe; no run artifacts |
| Foreground Dynamic subagent | high | PASS | real `DYNAMIC_CANARY_OK` |
| Background status and stop | high | PASS | real run active + stopped; zero extension errors |
| Pause/resume/reload/cold recovery | high | PASS | exact upstream 3.4.1 release gate, 1,150 tests |
| Setup atomicity and drift | high | PASS | 46-test package suite incl. missing source, stale, rollback, lock, symlink |
| Trust and secret boundary | fatal | PASS | trust smoke, setup contract, sanitized probes |
| Production advisory posture | high | PASS | narrowed exact audit allowance |
| Independent current-diff review | fatal | PASS | `docs/skill-outputs/me-review/2026-07-27-dynamic-workflows-cutover.md` |

No failed fatal row. Runtime restart behavior is dependency-owned and was replayed through the exact pinned upstream release suite rather than a lookalike implementation.

## Installed observation

- Doctor: healthy, 8/8 Fabric-captured, runtime config healthy.
- Canary: `installed-canary-ms3nkvfj-gzou1x` completed with exact result `INSTALLED_DYNAMIC_CANARY_OK`.
