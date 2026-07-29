#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d /tmp/pi-haziq-packed.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"
TARBALL="$(npm pack --pack-destination "$TMP" --silent)"
TARBALL="$TMP/$TARBALL"

mkdir -p "$TMP/consumer"
cd "$TMP/consumer"
npm init -y >/dev/null
npm install --omit=dev --legacy-peer-deps "$TARBALL" >/dev/null

PACKAGE="$TMP/consumer/node_modules/pi-haziq"
node - "$PACKAGE" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const fabricRoot = path.join(root, "node_modules", "pi-fabric");
const fabric = JSON.parse(fs.readFileSync(path.join(fabricRoot, "package.json"), "utf8"));
const coreDependencies = Object.keys(fabric.dependencies ?? {})
  .filter((name) => name.startsWith("@earendil-works/"))
  .sort();
if (JSON.stringify(coreDependencies) !== JSON.stringify(["@earendil-works/pi-ai"])) {
  throw new Error(`unexpected Fabric core runtime dependencies: ${coreDependencies.join(", ")}`);
}
if (fabric.dependencies["@earendil-works/pi-ai"] !== "0.82.1") {
  throw new Error("Fabric standalone worker pi-ai pin changed without review");
}
const workerPiAi = path.join(fabricRoot, "node_modules", "@earendil-works", "pi-ai", "package.json");
if (!fs.existsSync(workerPiAi)) {
  throw new Error("Fabric standalone worker pi-ai runtime is missing from the packed artifact");
}
const workerPiAiManifest = JSON.parse(fs.readFileSync(workerPiAi, "utf8"));
if (workerPiAiManifest.version !== "0.82.1") {
  throw new Error(`unexpected Fabric worker pi-ai version: ${workerPiAiManifest.version}`);
}
NODE
PI_HAZIQ_SMOKE_PI_BIN="$(command -v pi)" node "$PACKAGE/test/package-smoke.mjs"
PI_HAZIQ_SMOKE_PI_BIN="$(command -v pi)" node "$PACKAGE/test/trust-smoke.mjs"

if [[ -d "$TMP/consumer/node_modules/@mariozechner" ]]; then
  echo "legacy Pi core packages were installed" >&2
  exit 1
fi

echo "production package smoke: packed artifact loads without legacy Pi core copies"
