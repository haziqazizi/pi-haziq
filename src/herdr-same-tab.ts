import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "PI_HAZIQ_HERDR_SAME_TAB_V2";

function findHerdrTransport(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, "node_modules", "pi-fabric", "dist", "agents", "transports", "herdr-transport.js");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export type SplitDirection = "right" | "down";

/** Choose split direction from pane geometry (machine herdr skill rule). */
export function chooseSplitDirection(layout: {
  width?: number;
  height?: number;
  cols?: number;
  rows?: number;
} | null | undefined): SplitDirection {
  const width = Number(layout?.width ?? layout?.cols ?? 0);
  const height = Number(layout?.height ?? layout?.rows ?? 0);
  if (width > 0 && height > 0) return width >= height ? "right" : "down";
  return "right";
}

export function parseHerdrJson(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) throw new Error("herdr produced empty output");
  return JSON.parse(text);
}

export function extractPaneId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return undefined;
  const pane = (result as Record<string, unknown>).pane;
  if (!pane || typeof pane !== "object") return undefined;
  const id = (pane as Record<string, unknown>).pane_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export function extractTabId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return undefined;
  const pane = (result as Record<string, unknown>).pane;
  if (!pane || typeof pane !== "object") return undefined;
  const id = (pane as Record<string, unknown>).tab_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export function extractTerminalId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return undefined;
  const pane = (result as Record<string, unknown>).pane;
  if (!pane || typeof pane !== "object") return undefined;
  const id = (pane as Record<string, unknown>).terminal_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

/** Build a shell command line that execs argv without depending on PATH for the binary. */
export function argvToExecCommand(argv: string[]): string {
  if (argv.length === 0) throw new Error("command argv must not be empty");
  return "exec " + argv.map(shellQuote).join(" ");
}

/**
 * Replace Fabric's HerdrTransport so children open as sibling splits in the
 * caller's current tab (machine herdr skill default), not new background tabs.
 */

/** Rewrite bare --pi-binary pi to an absolute path when env provides one. */
export function rewriteWorkerArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const absolutePi = env.PI_FABRIC_PI_BINARY;
  if (!absolutePi || typeof absolutePi !== "string") return [...argv];
  if (!(absolutePi.startsWith("/") || /^[A-Za-z]:[\/]/.test(absolutePi))) return [...argv];
  const out = [...argv];
  for (let i = 0; i < out.length - 1; i += 1) {
    if (out[i] === "--pi-binary" && (out[i + 1] === "pi" || out[i + 1] === "pi.exe")) {
      out[i + 1] = absolutePi;
    }
  }
  return out;
}

export function ensureFabricHerdrSameTabTransport(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): { patched: boolean; path: string; reason?: string } {
  const transportPath = findHerdrTransport(startDir);
  if (!transportPath) return { patched: false, path: "", reason: "herdr-transport-not-found" };

  const existing = readFileSync(transportPath, "utf8");
  if (existing.includes(MARKER)) return { patched: false, path: transportPath, reason: "already-patched" };

  const source = [
    'import { execFile } from "node:child_process";',
    'import { EXTERNAL_TRANSPORT_LIVENESS_POLL_INTERVAL_MS } from "../constants.js";',
    'import { scriptSpawnArgs } from "./process-utils.js";',
    '// ' + MARKER,
    '',
    'const execHerdr = (args, env) => new Promise((resolve, reject) => {',
    '    execFile("herdr", args, { encoding: "utf8", env, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {',
    '        if (error) { Object.assign(error, { stdout, stderr }); reject(error); return; }',
    '        resolve({ stdout, stderr });',
    '    });',
    '});',
    '',
    'const parseJson = (stdout) => {',
    '    const text = String(stdout ?? "").trim();',
    '    if (!text) throw new Error("herdr produced empty output");',
    '    return JSON.parse(text);',
    '};',
    '',
    'const paneField = (payload, field) => {',
    '    const value = payload?.result?.pane?.[field];',
    '    return typeof value === "string" && value.length > 0 ? value : undefined;',
    '};',
    '',
    'const shellQuote = (value) => "\'" + String(value).replaceAll("\'", "\'\\"\'\\"\'") + "\'";',
    'const argvToExecCommand = (argv) => {',
    '    if (!Array.isArray(argv) || argv.length === 0) throw new Error("command argv must not be empty");',
    '    return "exec " + argv.map(shellQuote).join(" ");',
    '};',
    '',
    'const rewriteWorkerArgv = (argv, env) => {',
    '  const absolutePi = env?.PI_FABRIC_PI_BINARY;',
    '  if (!absolutePi || typeof absolutePi !== "string") return Array.isArray(argv) ? [...argv] : [];',
    '  const out = [...argv];',
    '  for (let i = 0; i < out.length - 1; i += 1) {',
    '    if (out[i] === "--pi-binary" && (out[i + 1] === "pi" || out[i + 1] === "pi.exe")) out[i + 1] = absolutePi;',
    '  }',
    '  return out;',
    '};',
    '',
    'const chooseDirection = async (paneId, env) => {',
    '    try {',
    '        const { stdout } = await execHerdr(["pane", "layout", "--pane", paneId], env);',
    '        const layout = parseJson(stdout)?.result?.layout ?? {};',
    '        const width = Number(layout.width ?? layout.cols ?? 0);',
    '        const height = Number(layout.height ?? layout.rows ?? 0);',
    '        if (width > 0 && height > 0) return width >= height ? "right" : "down";',
    '    } catch {}',
    '    return "right";',
    '};',
    '',
    'export class HerdrTransport {',
    '    environment;',
    '    kind = "herdr";',
    '    constructor(environment = process.env) { this.environment = environment; }',
    '    async available() {',
    '        if (this.environment.HERDR_ENV !== "1" || !this.environment.HERDR_SOCKET_PATH || !this.environment.HERDR_WORKSPACE_ID || !this.environment.HERDR_PANE_ID) return false;',
    '        try { await execHerdr(["pane", "get", this.environment.HERDR_PANE_ID], this.environment); return true; } catch { return false; }',
    '    }',
    '    async launch(request) {',
    '        const parentPaneId = this.environment.HERDR_PANE_ID;',
    '        const parentTabId = this.environment.HERDR_TAB_ID;',
    '        if (!parentPaneId) throw new Error("Herdr same-tab transport requires HERDR_PANE_ID");',
    '        const direction = await chooseDirection(parentPaneId, this.environment);',
    '        const rawCommand = await scriptSpawnArgs(request.workerPath, request.workerArguments); const command = rewriteWorkerArgv(rawCommand, this.environment); const childPath = this.environment.PI_FABRIC_CHILD_PATH || this.environment.PATH || "";',
    '        const splitArgs = ["pane", "split", parentPaneId, "--direction", direction, "--no-focus", "--cwd", request.cwd];',
    '        if (childPath) splitArgs.push("--env", "PATH=" + childPath); if (childPath) splitArgs.push("--env", "PI_FABRIC_CHILD_PATH=" + childPath);',
    '        if (this.environment.PI_FABRIC_PI_BINARY) splitArgs.push("--env", "PI_FABRIC_PI_BINARY=" + this.environment.PI_FABRIC_PI_BINARY);',
    '        if (this.environment.PI_FABRIC_NODE_BINARY) splitArgs.push("--env", "PI_FABRIC_NODE_BINARY=" + this.environment.PI_FABRIC_NODE_BINARY);',
    '        const splitPayload = parseJson((await execHerdr(splitArgs, this.environment)).stdout);',
    '        const paneId = paneField(splitPayload, "pane_id");',
    '        if (!paneId) throw new Error("herdr pane split did not return a pane id");',
    '        const tabId = paneField(splitPayload, "tab_id");',
    '        if (parentTabId && tabId && tabId !== parentTabId) {',
    '            try { await execHerdr(["pane", "close", paneId], this.environment); } catch {}',
    '            throw new Error("herdr same-tab split landed in " + tabId + ", expected " + parentTabId);',
    '        }',
    '        if (request.name) { try { await execHerdr(["pane", "rename", paneId, request.name], this.environment); } catch {} }',
    '        const runLine = childPath ? ("export PATH=" + shellQuote(childPath) + "; " + argvToExecCommand(command)) : argvToExecCommand(command); await execHerdr(["pane", "run", paneId, runLine], this.environment);',
    '        let terminalId = paneField(splitPayload, "terminal_id");',
    '        try { terminalId = paneField(parseJson((await execHerdr(["pane", "get", paneId], this.environment)).stdout), "terminal_id") ?? terminalId; } catch {}',
    '        return {',
    '            kind: this.kind,',
    '            livenessPollIntervalMs: EXTERNAL_TRANSPORT_LIVENESS_POLL_INTERVAL_MS,',
    '            sessionId: paneId,',
    '            ...(terminalId ? { attachCommand: "herdr terminal attach " + terminalId } : {}),',
    '            isAlive: async () => { try { await execHerdr(["pane", "get", paneId], this.environment); return true; } catch { return false; } },',
    '            stop: async () => { try { await execHerdr(["pane", "close", paneId], this.environment); } catch {} },',
    '        };',
    '    }',
    '}',
    '',
  ].join("\n");

  writeFileSync(transportPath, source, "utf8");
  return { patched: true, path: transportPath };
}
