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

Expected: `healthy` and `Tools: 8/8`.

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
npm:@lll9p/pi-better-compaction
npm:@quintinshaw/pi-dynamic-workflows@3.4.1
```

Keep the single `git:github.com/haziqazizi/pi-haziq` entry.

## 5. Apply non-secret configuration

Merge `config/settings.fragment.json` into `~/.pi/agent/settings.json` without changing the user's chosen default provider/model.

Copy or merge:

```text
config/pi-better-compaction.json
  → ~/.pi/agent/extensions/pi-better-compaction/config.json

config/pi-openai-service-tier.json
  → ~/.pi/agent/extensions/pi-openai-service-tier.json

config/workflow-model-tiers.json
  → ~/.pi/workflows/model-tiers.json
```

Review before overwriting local changes.

## 6. Reload and prove

```text
/reload
/cohesion doctor
```

Then verify:

- Each expected tool appears once.
- Model cycling contains the configured Meridian, Tokenmaxxing, and OpenAI Codex models.
- Herdr metadata reports `cohesion=healthy` when running inside Herdr.
- A workflow can link to the active todo and return without extension errors.

## Rollback

Restore the settings backup and reload Pi:

```bash
cp ~/.pi/agent/settings.json.pre-pi-haziq ~/.pi/agent/settings.json
```

The package does not modify or own provider authentication.
