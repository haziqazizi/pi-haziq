#!/usr/bin/env node
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { pinFabricLaunchBinaries } = await import(pathToFileURL(join(root, "src/fabric-binaries.ts")).href);
const { ensureFabricRuntimePrefersNodeOverride } = await import(pathToFileURL(join(root, "src/fabric-runtime-patch.ts")).href);
const pinned = pinFabricLaunchBinaries();
console.log("runtime-patch", ensureFabricRuntimePrefersNodeOverride(join(root, "src/fabric-runtime-patch.ts")));

if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_SOCKET_PATH || !process.env.HERDR_WORKSPACE_ID) {
  console.log("skip: not inside Herdr");
  process.exit(0);
}

const managerPath = join(root, "node_modules/pi-fabric/dist/agents/manager.js");
const configPath = join(root, "node_modules/pi-fabric/dist/config.js");
const { AgentManager } = await import(pathToFileURL(managerPath).href);
const { DEFAULT_FABRIC_CONFIG } = await import(pathToFileURL(configPath).href);

const runRoot = mkdtempSync(join(tmpdir(), "pi-fabric-e2e-"));
const config = {
  ...DEFAULT_FABRIC_CONFIG.agents,
  transport: "herdr",
  defaultTools: ["read", "ls"],
  extensions: true,
  retainRuns: true,
  notifyOnComplete: false,
  timeoutMs: 180_000,
  maxConcurrent: 1,
  maxPerExecution: 2,
  maxDepth: 1,
  thinking: "off",
};

const manager = new AgentManager(process.cwd(), config, {
  runRoot,
  piBinary: pinned.piBinary,
  fullCodeMode: false,
});

try {
  const result = await manager.run({
    name: "e2e-herdr-pi-path",
    task: "Reply with exactly the text HERDR_E2E_OK and nothing else. Do not use tools.",
    transport: "herdr",
    tools: [],
    extensions: true,
    thinking: "off",
  });
  const payload = {
    id: result.id,
    status: result.status,
    error: result.error,
    text: (result.text || "").slice(0, 400),
    transport: result.transport,
    turns: result.turns,
    piBinary: pinned.piBinary,
    runRoot,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (/spawn pi ENOENT/i.test(String(result.error || ""))) {
    console.error("FAIL: still spawn pi ENOENT");
    process.exit(1);
  }
  if (/spawn npx ENOENT/i.test(String(result.error || ""))) {
    console.error("FAIL: still spawn npx ENOENT (PATH launcher not applied)");
    process.exit(1);
  }
  if (result.status === "completed") {
    if (!String(result.text || "").includes("HERDR_E2E_OK")) {
      console.error("FAIL: completed without HERDR_E2E_OK");
      process.exit(1);
    }
    console.log("ok: herdr fabric agent completed with expected output");
    process.exit(0);
  }
  // Non-ENOENT failure still proves binary resolution for launch path.
  console.log("ok: herdr fabric agent launch avoided spawn pi ENOENT (status=" + result.status + ")");
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("FAIL:", message);
  if (/ENOENT|spawn pi/i.test(message)) process.exit(1);
  process.exit(1);
} finally {
  await manager.close().catch(() => undefined);
}
