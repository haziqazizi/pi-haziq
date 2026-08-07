import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "PI_HAZIQ_PREFER_NODE_OVERRIDE";

function findFabricProcessUtils(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, "node_modules", "pi-fabric", "dist", "agents", "transports", "process-utils.js");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Fabric's resolveScriptRuntime prefers process.execPath when it is already
 * node/bun, ignoring PI_FABRIC_NODE_BINARY. Under Herdr that launches the
 * worker with a minimal PATH, so npx/tsx extension startups fail.
 * Prefer an explicit PI_FABRIC_NODE_BINARY override first (our PATH launcher).
 */
export function ensureFabricRuntimePrefersNodeOverride(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): { patched: boolean; path: string; reason?: string } {
  const utilsPath = findFabricProcessUtils(startDir);
  if (!utilsPath) {
    return { patched: false, path: "", reason: "process-utils-not-found" };
  }

  let source = readFileSync(utilsPath, "utf8");
  if (source.includes(MARKER)) {
    return { patched: false, path: utilsPath, reason: "already-patched" };
  }

  const pattern =
    /const resolveScriptRuntimeUncached = async \(options = \{\}\) => \{\s*const execPath = options\.execPath \?\? process\.execPath;\s*const env = options\.env \?\? process\.env;\s*const requireNode = options\.requireNode === true;\s*if \(isGenericRuntime\(execPath, requireNode\)\)\s*return execPath;\s*const override = runtimeOverride\(env\);\s*if \(override\)\s*return override;/;

  if (!pattern.test(source)) {
    return { patched: false, path: utilsPath, reason: "pattern-miss" };
  }

  const replacement = `const resolveScriptRuntimeUncached = async (options = {}) => {
    const execPath = options.execPath ?? process.execPath;
    const env = options.env ?? process.env;
    const requireNode = options.requireNode === true;
    // ${MARKER}: honor PI_FABRIC_NODE_BINARY before process.execPath so Herdr
    // children can use a PATH-injecting launcher.
    const override = runtimeOverride(env);
    if (override)
        return override;
    if (isGenericRuntime(execPath, requireNode))
        return execPath;`;

  writeFileSync(utilsPath, source.replace(pattern, replacement), "utf8");
  return { patched: true, path: utilsPath };
}