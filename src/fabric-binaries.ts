import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

export type BinaryLookup = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  execPath?: string;
  pathDirs?: string[];
  platform?: NodeJS.Platform;
};

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    if (process.platform === "win32") return true;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readableFile(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pathDirsFrom(env: NodeJS.ProcessEnv, explicit?: string[]): string[] {
  if (explicit) return explicit;
  const raw = env.PATH ?? env.Path ?? "";
  return raw.split(delimiter).filter(Boolean);
}

function candidateInPath(name: string, dirs: string[], platform: NodeJS.Platform): string | undefined {
  const names =
    platform === "win32"
      ? [`${name}.cmd`, `${name}.exe`, name, `${name}.bat`]
      : [name];
  for (const dir of dirs) {
    for (const file of names) {
      const full = join(dir, file);
      if (isExecutableFile(full)) return full;
    }
  }
  return undefined;
}

function isJsEntrypoint(path: string): boolean {
  return path.toLowerCase().endsWith(".js") || path.toLowerCase().endsWith(".mjs");
}

/**
 * Resolve an absolute path to the pi CLI / cli.js for Fabric children.
 * Bare "pi" fails under Herdr panes with a minimal PATH.
 */
export function resolvePiBinary(lookup: BinaryLookup = {}): string {
  const env = lookup.env ?? process.env;
  const home = lookup.home ?? homedir();
  const platform = lookup.platform ?? process.platform;
  const execPath = lookup.execPath ?? process.execPath;
  const pathDirs = pathDirsFrom(env, lookup.pathDirs);

  const override = envValue(env, "PI_FABRIC_PI_BINARY");
  if (override && isAbsolute(override) && (isExecutableFile(override) || readableFile(override))) {
    return override;
  }
  if (override && !isAbsolute(override)) {
    const fromPath = candidateInPath(override, pathDirs, platform);
    if (fromPath) return fromPath;
  }

  if (/^pi(\.exe)?$/i.test(basename(execPath)) && isExecutableFile(execPath)) {
    return execPath;
  }

  const jsCandidates: string[] = [];
  try {
    const marker = join(home, ".pi", "agent", "pi-real-path");
    if (existsSync(marker)) {
      const marked = readFileSync(marker, "utf8").trim();
      if (marked) jsCandidates.push(marked);
    }
  } catch {
    // ignore
  }
  jsCandidates.push(join(home, ".local", "bin", "pi.real"));
  for (const candidate of jsCandidates) {
    if (candidate && isJsEntrypoint(candidate) && readableFile(candidate)) return candidate;
  }

  const homeCandidates = [join(home, ".pi", "agent", "bin", "pi"), join(home, ".local", "bin", "pi")];
  if (platform === "win32") {
    homeCandidates.push(join(home, ".pi", "agent", "bin", "pi.cmd"), join(home, ".local", "bin", "pi.cmd"));
  }
  for (const candidate of homeCandidates) {
    if (isExecutableFile(candidate)) return candidate;
  }

  const fromPath = candidateInPath("pi", pathDirs, platform);
  if (fromPath) return fromPath;
  return override || "pi";
}

/** Resolve absolute node/bun for documentation and PATH construction. */
export function resolveNodeBinary(lookup: BinaryLookup = {}): string {
  const env = lookup.env ?? process.env;
  const platform = lookup.platform ?? process.platform;
  const execPath = lookup.execPath ?? process.execPath;
  const pathDirs = pathDirsFrom(env, lookup.pathDirs);

  const override = envValue(env, "PI_FABRIC_NODE_BINARY");
  // Ignore legacy launcher path if still set from older installs.
  if (
    override &&
    isAbsolute(override) &&
    isExecutableFile(override) &&
    !basename(override).startsWith("pi-fabric-node")
  ) {
    return override;
  }
  if (override && !isAbsolute(override) && !override.includes("pi-fabric-node")) {
    const fromPath = candidateInPath(override, pathDirs, platform);
    if (fromPath) return fromPath;
  }

  const base = basename(execPath).toLowerCase();
  if (/^(node|bun)(\.exe)?$/.test(base) && isExecutableFile(execPath)) {
    return execPath;
  }
  for (const name of ["node", "bun"] as const) {
    const found = candidateInPath(name, pathDirs, platform);
    if (found) return found;
  }
  return "node";
}

/** Curated PATH for Fabric child workers: parent PATH + node dir + common user bins. */
export function buildFabricChildPath(lookup: BinaryLookup & { nodeBinary?: string } = {}): string {
  const env = lookup.env ?? process.env;
  const home = lookup.home ?? homedir();
  const nodeBinary = lookup.nodeBinary ?? resolveNodeBinary(lookup);
  const dirs = [
    dirname(nodeBinary),
    join(home, ".pi", "agent", "bin"),
    join(home, ".local", "bin"),
    join(home, ".local", "share", "pnpm"),
    ...(env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    ordered.push(dir);
  }
  return ordered.join(delimiter);
}

/**
 * Pin absolute pi binary and PATH for Fabric workers via environment only.
 * Does not install launchers or patch Fabric sources under node_modules.
 */
export function pinFabricLaunchBinaries(lookup: BinaryLookup = {}): {
  piBinary: string;
  nodeBinary: string;
  path: string;
  env: NodeJS.ProcessEnv;
} {
  const env = lookup.env ?? process.env;
  const piBinary = resolvePiBinary(lookup);
  const nodeBinary = resolveNodeBinary(lookup);
  const pathValue = buildFabricChildPath({ ...lookup, nodeBinary });

  if (isAbsolute(piBinary) && (isExecutableFile(piBinary) || readableFile(piBinary))) {
    env.PI_FABRIC_PI_BINARY = piBinary;
  }
  // Prefer real absolute node when set; clear legacy launcher override so Fabric
  // uses process.execPath (node) + PATH env on the Herdr pane instead.
  if (isAbsolute(nodeBinary) && isExecutableFile(nodeBinary)) {
    env.PI_FABRIC_NODE_BINARY = nodeBinary;
  } else if (env.PI_FABRIC_NODE_BINARY && basename(String(env.PI_FABRIC_NODE_BINARY)).startsWith("pi-fabric-node")) {
    delete env.PI_FABRIC_NODE_BINARY;
  }
  env.PATH = pathValue;
  env.PI_FABRIC_CHILD_PATH = pathValue;

  return { piBinary, nodeBinary, path: pathValue, env };
}
