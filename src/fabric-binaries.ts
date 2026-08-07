import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * Resolve an absolute path to the pi CLI for Fabric child workers.
 * Prefer a JS entrypoint (cli.js) so Fabric's worker can spawn it with
 * process.execPath/node — bash wrappers that call `/usr/bin/env node` fail
 * in Herdr panes with a minimal PATH (`spawn pi ENOENT` / missing node).
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

  const homeCandidates = [
    join(home, ".pi", "agent", "bin", "pi"),
    join(home, ".local", "bin", "pi"),
  ];
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

export function resolveNodeBinary(lookup: BinaryLookup = {}): string {
  const env = lookup.env ?? process.env;
  const platform = lookup.platform ?? process.platform;
  const execPath = lookup.execPath ?? process.execPath;
  const pathDirs = pathDirsFrom(env, lookup.pathDirs);

  const override = envValue(env, "PI_FABRIC_NODE_BINARY");
  // Ignore our own launcher when resolving the real runtime.
  if (
    override &&
    isAbsolute(override) &&
    isExecutableFile(override) &&
    !override.endsWith(`${basename(launcherName(platform))}`)
  ) {
    return override;
  }
  if (override && !isAbsolute(override)) {
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

function launcherName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pi-fabric-node.cmd" : "pi-fabric-node";
}

/** Build a PATH that includes node/npx and common user bins for Herdr children. */
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
 * Write a tiny launcher that exports an augmented PATH then execs the real node.
 * Herdr layout.apply runs the worker argv without a login shell; this is how we
 * get npx/node tools onto PATH for extension startup inside child panes.
 */
export function ensureFabricNodeLauncher(lookup: BinaryLookup & { nodeBinary?: string } = {}): string {
  const env = lookup.env ?? process.env;
  const home = lookup.home ?? homedir();
  const platform = lookup.platform ?? process.platform;
  const nodeBinary = lookup.nodeBinary ?? resolveNodeBinary(lookup);
  const pathValue = buildFabricChildPath({ ...lookup, nodeBinary });
  const binDir = join(home, ".pi", "agent", "bin");
  mkdirSync(binDir, { recursive: true });
  const launcherPath = join(binDir, launcherName(platform));

  if (platform === "win32") {
    const body = `@echo off\r\nset "PATH=${pathValue}"\r\n"${nodeBinary}" %*\r\n`;
    writeFileSync(launcherPath, body, { encoding: "utf8" });
  } else {
    const body = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `export PATH=${JSON.stringify(pathValue)}`,
      `exec ${JSON.stringify(nodeBinary)} "$@"`,
      "",
    ].join("\n");
    writeFileSync(launcherPath, body, { encoding: "utf8", mode: 0o755 });
    try {
      accessSync(launcherPath, constants.X_OK);
    } catch {
      // best effort
    }
  }
  return launcherPath;
}

/**
 * Pin Fabric child launch binaries to absolute paths for the process lifetime.
 * Also installs a PATH-injecting node launcher so Herdr children can resolve npx.
 */
export function pinFabricLaunchBinaries(lookup: BinaryLookup = {}): {
  piBinary: string;
  nodeBinary: string;
  launcherBinary: string;
  path: string;
  env: NodeJS.ProcessEnv;
} {
  const env = lookup.env ?? process.env;
  const piBinary = resolvePiBinary(lookup);
  const realNode = resolveNodeBinary(lookup);
  const pathValue = buildFabricChildPath({ ...lookup, nodeBinary: realNode });
  const launcherBinary = ensureFabricNodeLauncher({ ...lookup, nodeBinary: realNode });

  if (isAbsolute(piBinary) && (isExecutableFile(piBinary) || readableFile(piBinary))) {
    env.PI_FABRIC_PI_BINARY = piBinary;
  }
  // Point Fabric worker runtime at the PATH-injecting launcher.
  if (isAbsolute(launcherBinary) && isExecutableFile(launcherBinary)) {
    env.PI_FABRIC_NODE_BINARY = launcherBinary;
  } else if (isAbsolute(realNode) && isExecutableFile(realNode)) {
    env.PI_FABRIC_NODE_BINARY = realNode;
  }
  // Parent process also gets the augmented PATH for process-transport children.
  env.PATH = pathValue;

  return { piBinary, nodeBinary: realNode, launcherBinary, path: pathValue, env };
}
