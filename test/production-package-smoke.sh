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
PI_HAZIQ_SMOKE_PI_BIN="$(command -v pi)" node "$PACKAGE/test/package-smoke.mjs"

if [[ -d "$TMP/consumer/node_modules/@mariozechner" ]]; then
  echo "legacy Pi core packages were installed" >&2
  exit 1
fi

echo "production package smoke: packed artifact loads without legacy Pi core copies"
