import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";

export type HerdrDependencyStatus = "ready" | "missing-binary" | "missing-integration" | "failed";

export interface HerdrDependencyReport {
  status: HerdrDependencyStatus;
  binaryPath?: string;
  integrationPath: string;
  integrationPresent: boolean;
  message: string;
  details?: string;
}

export interface HerdrEnsureResult {
  report: HerdrDependencyReport;
  installedIntegration: boolean;
  command?: string;
  stdout?: string;
  stderr?: string;
}

export type HerdrExec = (
  file: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<{ code: number; stdout: string; stderr: string; killed?: boolean }>;

const HERDR_INSTALL_URL = "https://herdr.dev";

export function herdrIntegrationPath(agentDir: string): string {
  return join(agentDir, "extensions", "herdr-agent-state.ts");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve whether the herdr CLI is available. Prefer PATH lookup via `which`/`where`.
 */
export async function resolveHerdrBinary(
  exec: HerdrExec,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const which = platform === "win32" ? "where" : "which";
  try {
    const result = await exec(which, ["herdr"], { timeout: 5_000 });
    if (result.code !== 0 || result.killed) return undefined;
    const line = result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0);
    return line;
  } catch {
    return undefined;
  }
}

export async function inspectHerdrDependency(options: {
  agentDir: string;
  exec: HerdrExec;
  platform?: NodeJS.Platform;
}): Promise<HerdrDependencyReport> {
  const integrationPath = herdrIntegrationPath(options.agentDir);
  const integrationPresent = await pathExists(integrationPath);
  const binaryPath = await resolveHerdrBinary(options.exec, options.platform ?? process.platform);

  if (!binaryPath) {
    return {
      status: "missing-binary",
      integrationPath,
      integrationPresent,
      message: `Herdr CLI not found. Optional: install from ${HERDR_INSTALL_URL} only if you want pane transport when HERDR_ENV=1.`,
    };
  }

  if (!integrationPresent) {
    return {
      status: "missing-integration",
      binaryPath,
      integrationPath,
      integrationPresent: false,
      message: "Herdr CLI found but Pi integration is missing. Optional setup can run: herdr integration install pi",
    };
  }

  return {
    status: "ready",
    binaryPath,
    integrationPath,
    integrationPresent: true,
    message: "Herdr CLI and Pi integration are present (optional enrichment when HERDR_ENV=1).",
  };
}

/**
 * Ensure the Herdr-managed Pi integration is installed without editing the managed file directly.
 * Installs via `herdr integration install pi` when the binary exists and the integration is absent
 * or `force` is true. Never vendors or rewrites herdr-agent-state.ts from this package.
 */
export async function ensureHerdrIntegration(options: {
  agentDir: string;
  exec: HerdrExec;
  platform?: NodeJS.Platform;
  force?: boolean;
}): Promise<HerdrEnsureResult> {
  const before = await inspectHerdrDependency(options);
  if (before.status === "missing-binary") {
    return { report: before, installedIntegration: false };
  }

  if (before.status === "ready" && !options.force) {
    return { report: before, installedIntegration: false };
  }

  const binary = before.binaryPath ?? "herdr";
  const command = `${binary} integration install pi`;
  try {
    const result = await options.exec(binary, ["integration", "install", "pi"], { timeout: 60_000 });
    const after = await inspectHerdrDependency(options);
    if (result.code !== 0 || result.killed) {
      return {
        report: {
          status: "failed",
          binaryPath: before.binaryPath,
          integrationPath: before.integrationPath,
          integrationPresent: after.integrationPresent,
          message: "herdr integration install pi failed",
          details: (result.stderr || result.stdout || "no output").trim(),
        },
        installedIntegration: false,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
    if (!after.integrationPresent) {
      return {
        report: {
          status: "missing-integration",
          binaryPath: before.binaryPath,
          integrationPath: before.integrationPath,
          integrationPresent: false,
          message: "herdr integration install pi exited 0 but herdr-agent-state.ts is still missing",
          details: (result.stdout || result.stderr || "").trim(),
        },
        installedIntegration: false,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
    return {
      report: after,
      installedIntegration: true,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return {
      report: {
        status: "failed",
        binaryPath: before.binaryPath,
        integrationPath: before.integrationPath,
        integrationPresent: before.integrationPresent,
        message: "herdr integration install pi could not run",
        details,
      },
      installedIntegration: false,
      command,
    };
  }
}

export function formatHerdrDependencyReport(report: HerdrDependencyReport): string {
  const lines = [`Herdr dependency: ${report.status}`, report.message];
  if (report.binaryPath) lines.push(`Binary: ${report.binaryPath}`);
  lines.push(`Integration: ${report.integrationPresent ? "present" : "missing"} (${report.integrationPath})`);
  if (report.details) lines.push(report.details);
  return lines.join("\n");
}
