# Migration from standalone extensions

Do not load bundled and standalone copies simultaneously in the final configuration.

## 1. Back up

```bash
cp ~/.pi/agent/settings.json ~/.pi/agent/settings.json.pre-pi-haziq
```

Authentication and provider configuration remain where they are. Do not copy `auth.json` into this repository.

## 2. Install in an isolated run

From a checkout:

```bash
pi -e /path/to/pi-haziq
```

Run:

```text
/cohesion doctor
```

Expected: `healthy` and `Tools: 10/10 · Fabric-captured`. Run `/fabric captured` to inspect the exact lazy inventory without exposing those schemas to the parent model.

## 3. Install the package

```bash
pi install git:github.com/haziqazizi/pi-haziq
```

## 4. Remove standalone entries

After the package install succeeds, remove these old entries from `packages` in `~/.pi/agent/settings.json`:

```text
git:github.com/hjanuschka/pi-multi-pass
npm:@koltmcbride/pi-loop
npm:@juicesharp/rpiv-todo
npm:pi-openai-service-tier
npm:pi-image-preview
npm:pi-mcp-adapter@2.11.0
- `pi-tool-repair` (now bundled; remove any standalone install)
npm:@lll9p/pi-better-compaction
npm:@quintinshaw/pi-dynamic-workflows@3.4.1
npm:pi-subagents
npm:pi-fabric
```

Keep the single `git:github.com/haziqazizi/pi-haziq` entry.

If `designing-dynamic-workflows` is also installed under `~/.pi/agent/skills`, `~/.agents/skills`, or project skill directories, disable that standalone resource with `pi config` or remove the old clone/symlink after confirming it contains no unpublished work. The bundled commit must be the only discovered skill with that name. Do not let setup delete machine-local skills automatically.

## 5. Apply non-secret configuration and the Pi preamble

Start Pi and run:

```text
/cohesion setup check
/cohesion setup
```

The first command is read-only. The second shows a key-only, value-redacted preview and requires confirmation. It takes an exclusive setup lock, revalidates every preview row after confirmation and before replacement, stages complete replacements, atomically replaces each target, and backs up changed files. It then:

- links the package-owned `APPEND_SYSTEM.md` into Pi's global agent directory (`getAgentDir()`);
- merges `config/settings.fragment.json` without changing the chosen default provider/model or package list;
- merges the better-compaction, service-tier, and workflow-tier templates where those pinned owners actually read them;
- disables Fabric agents/mesh, keeps only `fabric_exec` visible, captures Dynamic and `pi-subagents` tools with explicit risks, and disables Dynamic's competing keyword trigger.

It never touches `auth.json`, `models.json`, provider credentials, MCP authentication, sessions, trust decisions, or caches. If an owned JSON target is malformed, an unexpected configuration symlink is present, or any target changes after preview, setup fails before changing files. Pi agent-directory overrides are honored for Pi-owned files; pinned extensions that hardcode `~/.pi` continue to receive config there.

For manual recovery, the target mapping is:

```text
APPEND_SYSTEM.md
  → <getAgentDir()>/APPEND_SYSTEM.md
config/settings.fragment.json
  → <getAgentDir()>/settings.json
config/pi-better-compaction.json
  → ~/.pi/agent/extensions/pi-better-compaction/config.json
config/pi-openai-service-tier.json
  → ~/.pi/agent/extensions/pi-openai-service-tier.json
config/workflow-model-tiers.json
  → ~/.pi/workflows/model-tiers.json
config/fabric.json
  → <getAgentDir()>/fabric.json
config/workflow-settings.json
  → ~/.pi/workflows/settings.json
```

## 6. Reload and prove

```text
/reload
/cohesion doctor
```

Then run `/cohesion contract`. It reports `loaded` when Pi selected the global append file, or `extension fallback ready` when a trusted project/CLI append source shadows it; cohesion injects the package contract before the next agent turn in the latter case.

Also verify:

- Each expected tool appears once.
- Model cycling contains the configured Meridian, Tokenmaxxing, and OpenAI Codex models.
- Herdr metadata reports `cohesion=healthy` when running inside Herdr.
- A workflow can link to the active todo and return without extension errors.

## Rollback

`/cohesion setup` reports every created/updated target and the exact backup path for each update.

- For an **updated** target, move its reported `.pre-pi-haziq-<timestamp>` backup back over the target.
- For a **created** target, remove that target.
- Restore all targets from the same setup run before reloading; do not mix timestamps from different runs.
- Then run `/reload` and `/cohesion doctor`.

The affected target set is the seven mappings in step 5: global append policy, settings fragment, better compaction, service tier, workflow tiers, Fabric runtime policy, and Dynamic Workflow settings. The package does not modify or own provider authentication.
