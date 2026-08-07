import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join } from "node:path";

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
    // On Windows, existence is enough for our purposes; exec bit is not reliable.
    if (process.platform === "win32") return true;
    accessSync(path, constants.X_OK);
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

function readableFile(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an absolute path to the pi CLI for Fabric child workers.
 * Bare "pi" fails under Herdr panes that do not inherit the parent PATH
 * (`spawn pi ENOENT`). Prefer a JS entrypoint (cli.js) so Fabric's worker
 * can spawn it with process.execPath/node — bash wrappers that call
 * `/usr/bin/env node` also fail in Herdr panes with a minimal PATH.
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

  // Prefer real JS CLI entrypoints first (worker spawns these via node/execPath).
  const jsCandidates: string[] = [];
  try {
    const marker = join(home, ".pi", "agent", "pi-real-path");
    if (existsSync(marker)) {
      const marked = readFileSync(marker, "utf8").trim();
      if (marked) jsCandidates.push(marked);
    }
  } catch {
    // ignore unreadable marker
  }
  jsCandidates.push(join(home, ".local", "bin", "pi.real"));
  try {
    // Malaysian VPS toolchain layout: .../npm/<hash>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
    const npmRoot = join(home, ".local", "share", "malaysian-vps", "toolchains", "npm");
    if (existsSync(npmRoot)) {
      // Lightweight: only check the marker path above; scanning all hashes is done
      // by the shell wrapper. Here we accept pi-real-path / pi.real.
    }
  } catch {
    // ignore
  }
  for (const candidate of jsCandidates) {
    if (candidate && isJsEntrypoint(candidate) && readableFile(candidate)) return candidate;
  }

  const homeCandidates = [
    join(home, ".pi", "agent", "bin", "pi"),
    join(home, ".local", "bin", "pi"),
  ];
  if (platform === "win32") {
    homeCandidates.push(
      join(home, ".pi", "agent", "bin", "pi.cmd"),
      join(home, ".local", "bin", "pi.cmd"),
    );
  }
  for (const candidate of homeCandidates) {
    if (isExecutableFile(candidate)) return candidate;
  }

  const fromPath = candidateInPath("pi", pathDirs, platform);
  if (fromPath) return fromPath;

  // Last resort: keep prior Fabric default so error messages stay familiar.
  return override || "pi";
}

/**
 * Resolve an absolute Node/Bun runtime for launching Fabric's worker.js.
 * Herdr layout.apply executes argv without a login shell, so a bare "node"
 * can also ENOENT. Prefer the current process when it is already node/bun.
 */
export function resolveNodeBinary(lookup: BinaryLookup = {}): string {
  const env = lookup.env ?? process.env;
  const platform = lookup.platform ?? process.platform;
  const execPath = lookup.execPath ?? process.execPath;
  const pathDirs = pathDirsFrom(env, lookup.pathDirs);

  const override = envValue(env, "PI_FABRIC_NODE_BINARY");
  if (override && isAbsolute(override) && isExecutableFile(override)) return override;
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

  return override || "node";
}

/**
 * Pin Fabric child launch binaries to absolute paths for the process lifetime.
 * Safe to call multiple times; does not overwrite an already-absolute usable override.
 */
export function pinFabricLaunchBinaries(lookup: BinaryLookup = {}): {
  piBinary: string;
  nodeBinary: string;
  env: NodeJS.ProcessEnv;
} {
  const env = lookup.env ?? process.env;
  const piBinary = resolvePiBinary(lookup);
  const nodeBinary = resolveNodeBinary(lookup);

  if (isAbsolute(piBinary) && (isExecutableFile(piBinary) || readableFile(piBinary))) {
    env.PI_FABRIC_PI_BINARY = piBinary;
  }
  if (isAbsolute(nodeBinary) && isExecutableFile(nodeBinary)) {
    env.PI_FABRIC_NODE_BINARY = nodeBinary;
  }

  return { piBinary, nodeBinary, env };
}
