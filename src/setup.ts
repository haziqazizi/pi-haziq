import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, link, lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type SetupOperationKind = "json" | "symlink";
export type SetupOperationStatus = "create" | "update" | "unchanged";

export interface SetupOperation {
  kind: SetupOperationKind;
  label: string;
  source: string;
  target: string;
  root: string;
  lockPath: string;
  status: SetupOperationStatus;
  fingerprint: string;
  changedKeys: string[];
  desired?: Record<string, unknown>;
}

export interface SetupPaths {
  packageRoot: string;
  agentDir: string;
  ownerAgentDir: string;
  workflowDir: string;
  lockPath: string;
}

export interface AppliedSetupOperation {
  label: string;
  target: string;
  status: Exclude<SetupOperationStatus, "unchanged">;
  backup?: string;
}

type JsonObject = Record<string, unknown>;
type ChangedSetupOperation = SetupOperation & { status: "create" | "update" };
type AppliedInternal = AppliedSetupOperation & { installedFingerprint: string };

interface StagedOperation {
  operation: ChangedSetupOperation;
  path: string;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function pathKind(path: string): Promise<"missing" | "symlink" | "other"> {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink() ? "symlink" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function targetFingerprint(path: string): Promise<string> {
  const kind = await pathKind(path);
  if (kind === "missing") return "missing";
  if (kind === "symlink") return `symlink:${await readlink(path)}`;
  const content = await readFile(path);
  return `file:${createHash("sha256").update(content).digest("hex")}`;
}

async function readJsonObject(path: string, missing: JsonObject = {}): Promise<JsonObject> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isObject(parsed)) throw new Error("expected a JSON object");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...missing };
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read JSON object at ${path}: ${message}`);
  }
}

function mergeObjects(existing: JsonObject, desired: JsonObject): JsonObject {
  const merged: JsonObject = { ...existing };
  for (const [key, value] of Object.entries(desired)) {
    const current = merged[key];
    merged[key] = isObject(current) && isObject(value)
      ? mergeObjects(current, value)
      : value;
  }
  return merged;
}

function mergeSettings(existing: JsonObject, desired: JsonObject): JsonObject {
  const merged = mergeObjects(existing, desired);
  const existingModels = Array.isArray(existing.enabledModels)
    ? existing.enabledModels.filter((value): value is string => typeof value === "string")
    : [];
  const desiredModels = Array.isArray(desired.enabledModels)
    ? desired.enabledModels.filter((value): value is string => typeof value === "string")
    : [];
  if (existingModels.length > 0 || desiredModels.length > 0) {
    merged.enabledModels = [...new Set([...existingModels, ...desiredModels])];
  }
  return merged;
}

function changedKeyPaths(existing: JsonObject, desired: JsonObject, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, desiredValue] of Object.entries(desired)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const existingValue = existing[key];
    if (isObject(existingValue) && isObject(desiredValue)) {
      paths.push(...changedKeyPaths(existingValue, desiredValue, path));
    } else if (!valueEqual(existingValue, desiredValue)) {
      paths.push(path);
    }
  }
  return paths;
}

export function defaultSetupPaths(
  packageRoot: string,
  home = homedir(),
  agentDir = getAgentDir(),
): SetupPaths {
  return {
    packageRoot,
    agentDir,
    // These pinned owners currently document and read ~/.pi directly rather
    // than Pi's configurable agent directory. Keep their targets honest.
    ownerAgentDir: join(home, ".pi", "agent"),
    workflowDir: join(home, ".pi", "workflows"),
    lockPath: join(home, ".pi", ".pi-haziq-setup.lock"),
  };
}

async function assertSafePath(rootPath: string, targetPath: string): Promise<void> {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  const targetRelative = relative(root, target);
  if (targetRelative === "" || targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
    throw new Error(`Setup target escapes its documented root: ${targetPath}`);
  }

  // The configured root itself may intentionally be a symlink. Refuse only
  // nested parent symlinks, which could redirect one documented target.
  const parentRelative = relative(root, dirname(target));
  let cursor = root;
  for (const segment of parentRelative.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    const kind = await pathKind(cursor);
    if (kind === "symlink") throw new Error(`Refusing setup through nested parent symlink: ${cursor}`);
    if (kind === "missing") break;
  }
}

async function assertSafeTarget(operation: SetupOperation): Promise<void> {
  await assertSafePath(operation.root, operation.target);
}

async function planJson(
  label: string,
  source: string,
  target: string,
  root: string,
  lockPath: string,
  merge: (existing: JsonObject, desired: JsonObject) => JsonObject = mergeObjects,
): Promise<SetupOperation> {
  await assertSafePath(root, target);
  const desiredTemplate = await readJsonObject(source);
  const targetKind = await pathKind(target);
  if (targetKind === "symlink") {
    throw new Error(`Refusing to replace unexpected symlink at ${target}`);
  }
  const existing = await readJsonObject(target);
  const desired = merge(existing, desiredTemplate);
  const changedKeys = changedKeyPaths(existing, desired);
  const operation: SetupOperation = {
    kind: "json",
    label,
    source,
    target,
    root,
    lockPath,
    status: targetKind === "missing" ? "create" : changedKeys.length === 0 ? "unchanged" : "update",
    fingerprint: await targetFingerprint(target),
    changedKeys,
    desired,
  };
  await assertSafeTarget(operation);
  return operation;
}

async function planSymlink(
  label: string,
  source: string,
  target: string,
  root: string,
  lockPath: string,
): Promise<SetupOperation> {
  await assertSafePath(root, target);
  if (await pathKind(source) === "missing") throw new Error(`Missing package setup source: ${source}`);
  const targetKind = await pathKind(target);
  let unchanged = false;
  if (targetKind === "symlink") {
    const linked = await readlink(target);
    const resolved = isAbsolute(linked) ? linked : resolve(dirname(target), linked);
    unchanged = resolve(resolved) === resolve(source);
  }
  const operation: SetupOperation = {
    kind: "symlink",
    label,
    source,
    target,
    root,
    lockPath,
    status: targetKind === "missing" ? "create" : unchanged ? "unchanged" : "update",
    fingerprint: await targetFingerprint(target),
    changedKeys: unchanged ? [] : ["link target"],
  };
  await assertSafeTarget(operation);
  return operation;
}

export async function planSetup(paths: SetupPaths): Promise<SetupOperation[]> {
  const configDir = join(paths.packageRoot, "config");
  return Promise.all([
    planSymlink(
      "Pi appended system policy",
      join(paths.packageRoot, "APPEND_SYSTEM.md"),
      join(paths.agentDir, "APPEND_SYSTEM.md"),
      paths.agentDir,
      paths.lockPath,
    ),
    planJson(
      "Pi settings fragment",
      join(configDir, "settings.fragment.json"),
      join(paths.agentDir, "settings.json"),
      paths.agentDir,
      paths.lockPath,
      mergeSettings,
    ),
    planJson(
      "Better compaction",
      join(configDir, "pi-better-compaction.json"),
      join(paths.ownerAgentDir, "extensions", "pi-better-compaction", "config.json"),
      paths.ownerAgentDir,
      paths.lockPath,
    ),
    planJson(
      "OpenAI service tier",
      join(configDir, "pi-openai-service-tier.json"),
      join(paths.ownerAgentDir, "extensions", "pi-openai-service-tier.json"),
      paths.ownerAgentDir,
      paths.lockPath,
    ),
    planJson(
      "Workflow model tiers",
      join(configDir, "workflow-model-tiers.json"),
      join(paths.workflowDir, "model-tiers.json"),
      paths.workflowDir,
      paths.lockPath,
    ),
  ]);
}

function timestampToken(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function backupCandidate(target: string, token: string, index: number): string {
  const base = `${target}.pre-pi-haziq-${token}`;
  return index === 1 ? base : `${base}-${index}`;
}

async function createBackupExclusive(target: string, token: string): Promise<string> {
  for (let index = 1; index < 1000; index += 1) {
    const candidate = backupCandidate(target, token, index);
    try {
      if (await pathKind(target) === "symlink") {
        await symlink(await readlink(target), candidate);
      } else {
        await copyFile(target, candidate, fsConstants.COPYFILE_EXCL);
      }
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error(`Could not allocate backup path for ${target}`);
}

async function assertFresh(operation: SetupOperation): Promise<void> {
  if (await targetFingerprint(operation.target) !== operation.fingerprint) {
    throw new Error(`Setup target changed after preview; run /cohesion setup again: ${operation.target}`);
  }
}

async function stageOperation(operation: ChangedSetupOperation, index: number): Promise<StagedOperation> {
  await mkdir(dirname(operation.target), { recursive: true });
  const path = `${operation.target}.pi-haziq-stage-${process.pid}-${index}`;
  await rm(path, { force: true });
  if (operation.kind === "symlink") {
    await symlink(operation.source, path);
  } else {
    if (!operation.desired) throw new Error(`Missing desired JSON for ${operation.target}`);
    await writeFile(path, `${JSON.stringify(operation.desired, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  return { operation, path };
}

async function installStaged(staged: StagedOperation): Promise<void> {
  const { operation, path } = staged;
  if (operation.status === "update") {
    await rename(path, operation.target);
    return;
  }
  if (operation.kind === "symlink") {
    await symlink(operation.source, operation.target);
    return;
  }
  await link(path, operation.target);
}

async function acquireSetupLock(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Another pi-haziq setup is active: ${path}`);
    }
    throw error;
  }
}

export async function applySetup(
  operations: SetupOperation[],
  now = new Date(),
  options: {
    beforeInstall?: (operation: SetupOperation, index: number) => Promise<void> | void;
    lockPath?: string;
  } = {},
): Promise<AppliedSetupOperation[]> {
  if (operations.length === 0) return [];
  for (const operation of operations) await assertSafeTarget(operation);

  const changed = operations.filter(
    (operation): operation is ChangedSetupOperation => operation.status !== "unchanged",
  );
  const declaredLocks = new Set(operations.map((operation) => operation.lockPath));
  if (declaredLocks.size !== 1) throw new Error("Setup preview contains inconsistent lock paths");
  const lockPath = options.lockPath ?? operations[0].lockPath;
  const staged: StagedOperation[] = [];
  const applied: AppliedInternal[] = [];
  const token = timestampToken(now);
  let locked = false;

  try {
    await acquireSetupLock(lockPath);
    locked = true;

    // Revalidate every preview row, including rows that were unchanged. The
    // confirmation may stay open while another process edits configuration.
    for (const operation of operations) {
      await assertSafeTarget(operation);
      await assertFresh(operation);
    }
    if (changed.length === 0) return [];

    for (let index = 0; index < changed.length; index += 1) {
      await assertSafeTarget(changed[index]);
      staged.push(await stageOperation(changed[index], index));
    }

    // Stage every complete replacement before the first live target changes,
    // then revalidate the whole plan once more.
    for (const operation of operations) {
      await assertSafeTarget(operation);
      await assertFresh(operation);
    }

    for (let index = 0; index < staged.length; index += 1) {
      const item = staged[index];
      const { operation } = item;
      const installedFingerprint = await targetFingerprint(item.path);
      await options.beforeInstall?.(operation, index);
      const alreadyApplied = new Set(applied.map((entry) => entry.target));
      for (const previewed of operations) {
        if (!alreadyApplied.has(previewed.target)) {
          await assertSafeTarget(previewed);
          await assertFresh(previewed);
        }
      }

      let backup: string | undefined;
      if (operation.status === "update") {
        backup = await createBackupExclusive(operation.target, token);
        try {
          await assertSafeTarget(operation);
          await assertFresh(operation);
        } catch (error) {
          await rm(backup, { force: true });
          throw error;
        }
      }

      try {
        await installStaged(item);
      } catch (error) {
        if (backup) await rm(backup, { force: true });
        throw error;
      }

      // The expected installed fingerprint was computed before mutation, so
      // this synchronous journal write leaves no fallible post-replacement gap.
      applied.push({
        label: operation.label,
        target: operation.target,
        status: operation.status,
        backup,
        installedFingerprint,
      });
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const operation of [...applied].reverse()) {
      try {
        const current = await targetFingerprint(operation.target);
        if (current !== operation.installedFingerprint) {
          throw new Error(`Refusing to overwrite a post-setup change during rollback: ${operation.target}`);
        }
        if (operation.backup) {
          await rename(operation.backup, operation.target);
        } else {
          await rm(operation.target, { force: true });
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "pi-haziq setup failed and rollback requires manual recovery");
    }
    throw error;
  } finally {
    // Staged paths are no longer live setup state. Cleanup is best-effort so a
    // temp-file deletion failure cannot turn a journaled successful mutation
    // into an unrollbackable reported failure.
    await Promise.allSettled(staged.map((item) => rm(item.path, { force: true })));
    if (locked) await rm(lockPath, { recursive: true, force: true });
  }

  return applied.map(({ installedFingerprint: _installedFingerprint, ...operation }) => operation);
}

export function formatSetupPlan(operations: SetupOperation[]): string {
  const lines = operations.flatMap((operation) => {
    const marker = operation.status === "unchanged" ? "✓" : operation.status === "create" ? "+" : "~";
    const summary = `${marker} ${operation.label}: ${operation.status} · ${operation.target}`;
    return operation.changedKeys.length > 0
      ? [summary, `  keys: ${operation.changedKeys.join(", ")}`]
      : [summary];
  });
  const changed = operations.filter((operation) => operation.status !== "unchanged").length;
  return [
    `pi-haziq setup: ${changed} change${changed === 1 ? "" : "s"}`,
    "Preview is key-only; existing values are not printed.",
    "",
    ...lines,
  ].join("\n");
}
