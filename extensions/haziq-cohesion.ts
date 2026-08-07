import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  STATE_ENTRY_TYPE,
  activeTodoIdFromDetails,
  allVisibleTodosCompleted,
  createSnapshot,
  deriveCapabilities,
  execResultSucceeded,
  extractWorkflowDelivery,
  extractWorkflowRunId,
  formatCohesionStatus,
  inspectRuntimeConfiguration,
  inspectTools,
  makeEvent,
  normalizeWorkflowStatus,
  restoreLatestSnapshot,
  runningWorkflowIds,
  selectWorkflowTodoId,
  textFromToolContent,
  upsertWorkflow,
  workflowInstruction,
  type CohesionSnapshot,
  type CompactionConfigLike,
  type NormalizedEvent,
  type RuntimeConfigurationHealth,
  type ServiceTierConfigLike,
  type ToolHealth,
  type WorkflowLink,
} from "../src/cohesion.ts";
import { appendPiHaziqContract, hasPiHaziqContract } from "../src/contract.ts";
import {
  MERIDIAN_REFRESH_STATUS_EVENT,
  formatMeridianRefreshStatus,
  isMeridianRefreshStatus,
  type MeridianRefreshStatus,
} from "../src/meridian-refresh.ts";
import { FABRIC_CAPTURED_TOOLS_EVENT } from "./haziq-fabric.ts";
import {
  ensureHerdrIntegration,
  formatHerdrDependencyReport,
  inspectHerdrDependency,
  type HerdrDependencyReport,
} from "../src/herdr.ts";
import { applySetup, defaultSetupPaths, formatSetupPlan, planSetup } from "../src/setup.ts";

const EVENT_LOG_LIMIT = 100;
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETUP_PATHS = defaultSetupPaths(PACKAGE_ROOT);
const APPEND_SYSTEM_SOURCE = join(PACKAGE_ROOT, "APPEND_SYSTEM.md");
const APPEND_SYSTEM_TARGET = join(SETUP_PATHS.agentDir, "APPEND_SYSTEM.md");
const APPEND_SYSTEM_POLICY = readFileSync(APPEND_SYSTEM_SOURCE, "utf8");
const HERDR_METADATA_TTL_MS = 120_000;
const BETTER_COMPACTION_CONFIG = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "pi-better-compaction",
  "config.json",
);
const SERVICE_TIER_CONFIG = join(homedir(), ".pi", "agent", "extensions", "pi-openai-service-tier.json");
const WORKFLOW_TIERS_CONFIG = join(homedir(), ".pi", "workflows", "model-tiers.json");
const FABRIC_CONFIG = join(SETUP_PATHS.agentDir, "fabric.json");
const WORKFLOW_SETTINGS_CONFIG = join(SETUP_PATHS.workflowDir, "settings.json");

function readJson<T>(path: string): T | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

function recordDetails(details: unknown): Record<string, unknown> {
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

function safeToken(value: unknown, fallback = "-"): string {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).replace(/[\r\n\t]/g, " ").slice(0, 120);
}

function mcpDescriptor(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const input = args as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of ["action", "mode", "server", "tool", "name"] as const) {
    const value = input[key];
    if (typeof value === "string") output[key] = value.slice(0, 160);
  }
  return output;
}

function configStatus(path: string, configured: boolean): string {
  return `${configured ? "✓" : "○"} ${path}`;
}

function appendSystemConfigured(): boolean {
  try {
    return existsSync(APPEND_SYSTEM_TARGET) && realpathSync(APPEND_SYSTEM_TARGET) === realpathSync(APPEND_SYSTEM_SOURCE);
  } catch {
    return false;
  }
}

function describeCapabilities(snapshot: CohesionSnapshot): string[] {
  const capabilities = snapshot.capabilities;
  if (!capabilities) return ["Model capabilities: unavailable"];
  return [
    `Model: ${capabilities.model ?? "unknown"}`,
    `API: ${capabilities.api ?? "unknown"}`,
    `Compaction: ${capabilities.compactionStrategy}${capabilities.compactionModel ? ` → ${capabilities.compactionModel}` : ""}`,
    `Service tier: ${capabilities.serviceTier ? capabilities.serviceTierName ?? "active" : "inactive"}`,
    `Images: ${capabilities.images ? "yes" : "no"}`,
    `Reasoning: ${capabilities.reasoning ? "yes" : "no"}`,
  ];
}

export default function haziqCohesion(pi: ExtensionAPI) {
  let snapshot = createSnapshot();
  let toolHealth: ToolHealth = inspectTools([]);
  let runtimeConfigHealth: RuntimeConfigurationHealth = inspectRuntimeConfiguration(undefined, undefined);
  let toolsCapturedByFabric = false;
  let fabricCapturedToolNames = new Set<string>();
  let mcpToolNames = new Set(["mcp"]);
  let eventLog: NormalizedEvent[] = [];
  let activeContext: ExtensionContext | undefined;
  let compactionConfig: CompactionConfigLike = {};
  let serviceTierConfig: ServiceTierConfigLike = {};
  let meridianRefreshStatus: MeridianRefreshStatus | undefined;
  let unsubscribeMeridianRefresh: (() => void) | undefined;
  let unsubscribeFabricCapturedTools: (() => void) | undefined;
  let herdrMetadataInFlight = false;
  let herdrMetadataQueued = false;
  let herdrOperational: boolean | undefined;
  let herdrDependency: HerdrDependencyReport | undefined;
  let shuttingDown = false;
  let pendingTodoClearsActive = false;
  const pendingTodoCandidates = new Set<number>();
  const workflowTodoByCall = new Map<string, number | undefined>();

  const herdrEnabled =
    process.env.HERDR_ENV === "1" &&
    typeof process.env.HERDR_PANE_ID === "string" &&
    process.env.HERDR_PANE_ID.length > 0;
  const herdrNotifications = process.env.HAZIQ_COHESION_HERDR_NOTIFICATIONS === "1";

  function emit<T>(channel: string, source: string, data: T, options: { runId?: string; taskId?: number } = {}) {
    const event = makeEvent(snapshot, source, data, options);
    eventLog.push(event);
    if (eventLog.length > EVENT_LOG_LIMIT) eventLog = eventLog.slice(-EVENT_LOG_LIMIT);
    pi.events.emit(channel, event);
  }

  unsubscribeMeridianRefresh = pi.events.on(MERIDIAN_REFRESH_STATUS_EVENT, (value) => {
    if (!isMeridianRefreshStatus(value)) return;
    meridianRefreshStatus = value;
    eventLog.push(makeEvent(snapshot, "meridian", value));
    if (eventLog.length > EVENT_LOG_LIMIT) eventLog = eventLog.slice(-EVENT_LOG_LIMIT);
  });

  unsubscribeFabricCapturedTools = pi.events.on(FABRIC_CAPTURED_TOOLS_EVENT, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const names = (value as { names?: unknown }).names;
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) return;
    fabricCapturedToolNames = new Set(names);
  });

  function persist() {
    pi.appendEntry(STATE_ENTRY_TYPE, snapshot);
  }

  function loadConfigs(ctx = activeContext) {
    compactionConfig = readJson<CompactionConfigLike>(BETTER_COMPACTION_CONFIG) ?? {};
    const globalTier = readJson<ServiceTierConfigLike>(SERVICE_TIER_CONFIG) ?? {};
    const projectTierPath = ctx ? join(ctx.cwd, CONFIG_DIR_NAME, "extensions", "pi-openai-service-tier.json") : undefined;
    const projectTier =
      ctx && ctx.isProjectTrusted() && projectTierPath
        ? (readJson<ServiceTierConfigLike>(projectTierPath) ?? {})
        : {};
    serviceTierConfig = { ...globalTier, ...projectTier };
  }

  function refreshCapabilities(ctx: ExtensionContext) {
    loadConfigs(ctx);
    snapshot = {
      ...snapshot,
      capabilities: deriveCapabilities(ctx.model, compactionConfig, serviceTierConfig),
    };
  }

  function restoreBranchState(ctx: ExtensionContext) {
    snapshot = restoreLatestSnapshot(ctx.sessionManager.getBranch());
    snapshot = {
      ...snapshot,
      sessionId: ctx.sessionManager.getSessionId(),
      cwd: ctx.cwd,
    };
    refreshCapabilities(ctx);
  }

  function refreshRuntimeConfigHealth() {
    runtimeConfigHealth = inspectRuntimeConfiguration(readJson(FABRIC_CONFIG), readJson(WORKFLOW_SETTINGS_CONFIG));
  }

  async function refreshHerdrDependency() {
    herdrDependency = await inspectHerdrDependency({
      agentDir: SETUP_PATHS.agentDir,
      exec: async (file, args, options) => {
        const result = await pi.exec(file, args, { timeout: options?.timeout ?? 5_000 });
        return {
          code: result.code,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          killed: result.killed,
        };
      },
    });
    return herdrDependency;
  }

  function refreshToolHealth() {
    const tools = pi.getAllTools();
    const directlyVisibleNames = tools.map((tool) => tool.name);
    toolsCapturedByFabric = directlyVisibleNames.includes("fabric_exec") && fabricCapturedToolNames.size > 0;
    toolHealth = inspectTools(toolsCapturedByFabric ? fabricCapturedToolNames : directlyVisibleNames);
    mcpToolNames = new Set([
      "mcp",
      ...tools
        .filter(
          (tool) =>
            tool.name === "mcp" ||
            tool.sourceInfo.path.includes("pi-mcp-adapter") ||
            tool.sourceInfo.path.includes("haziq-mcp"),
        )
        .map((tool) => tool.name),
    ]);
  }

  function statusText(): string | undefined {
    return formatCohesionStatus({
      missingTools: toolHealth.missing,
      configProblems: runtimeConfigHealth.problems,
      activeWorkflowRuns: runningWorkflowIds(snapshot).length,
    });
  }

  function updateStatus(ctx = activeContext) {
    if (!ctx?.hasUI) return;
    // Quiet when healthy: permanent "cohesion ✓" only adds footer noise.
    ctx.ui.setStatus("haziq-cohesion", statusText());
  }

  async function executeHerdr(args: string[], operation: string) {
    const result = await pi.exec("herdr", args, { timeout: 5_000 });
    if (!execResultSucceeded(result)) {
      throw new Error(`${operation} failed (code ${result.code}${result.killed ? ", killed" : ""})`);
    }
    herdrOperational = true;
  }

  function reportHerdrFailure(operation: string, error: unknown) {
    herdrOperational = false;
    emit("haziq:herdr-failed", "herdr", {
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async function writeHerdrMetadata() {
    if (!herdrEnabled || !activeContext || shuttingDown) return;
    const paneId = process.env.HERDR_PANE_ID;
    if (!paneId) return;
    const capabilities = snapshot.capabilities;
    const running = runningWorkflowIds(snapshot);
    const args = [
      "pane",
      "report-metadata",
      paneId,
      "--source",
      "haziq:cohesion",
      "--agent",
      "pi",
      "--applies-to-source",
      "herdr:pi",
      "--token",
      `model=${safeToken(capabilities?.model)}`,
      "--token",
      `api=${safeToken(capabilities?.api)}`,
      "--token",
      `thinking=${safeToken(pi.getThinkingLevel())}`,
      "--token",
      `todo=${snapshot.activeTodoId === undefined ? "-" : `#${snapshot.activeTodoId}`}`,
      "--token",
      `workflow=${safeToken(running[0], "-")}`,
      "--token",
      `workflow_count=${running.length}`,
      "--token",
      `compaction=${safeToken(capabilities?.compactionStrategy)}`,
      "--token",
      `compaction_model=${safeToken(capabilities?.compactionModel)}`,
      "--token",
      `cohesion=${toolHealth.status}`,
      "--ttl-ms",
      String(HERDR_METADATA_TTL_MS),
    ];
    await executeHerdr(args, "pane.report-metadata");
  }

  function queueHerdrMetadata() {
    if (!herdrEnabled || shuttingDown) return;
    herdrMetadataQueued = true;
    if (herdrMetadataInFlight) return;
    herdrMetadataInFlight = true;
    void (async () => {
      try {
        while (herdrMetadataQueued && !shuttingDown) {
          herdrMetadataQueued = false;
          await writeHerdrMetadata();
        }
      } catch (error) {
        reportHerdrFailure("pane.report-metadata", error);
      } finally {
        herdrMetadataInFlight = false;
        if (herdrMetadataQueued && !shuttingDown) queueHerdrMetadata();
      }
    })();
  }

  function notifyHerdr(title: string, body: string, sound: "done" | "request") {
    if (!herdrEnabled || !herdrNotifications) return;
    void executeHerdr(
      ["notification", "show", title, "--body", body, "--sound", sound],
      "notification.show",
    ).catch((error) => reportHerdrFailure("notification.show", error));
  }

  function workflowByRunId(runId: string | undefined): WorkflowLink | undefined {
    if (runId) return snapshot.workflows[runId];
    const running = runningWorkflowIds(snapshot);
    if (running.length === 1) return snapshot.workflows[running[0]];
    return undefined;
  }

  function upsertRun(link: Omit<WorkflowLink, "updatedAt">) {
    snapshot = upsertWorkflow(snapshot, link);
    persist();
    updateStatus();
    queueHerdrMetadata();
  }

  function doctorReport(): string {
    const running = runningWorkflowIds(snapshot);
    const lines = [
      `Haziq cohesion: ${toolHealth.status}`,
      "",
      `Tools: ${toolHealth.present.length}/${toolHealth.expected.length}${toolsCapturedByFabric ? " · Fabric-captured" : ""}`,
      ...(toolHealth.missing.length > 0 ? [`Missing: ${toolHealth.missing.join(", ")}`] : []),
      `Runtime config: ${runtimeConfigHealth.status}`,
      ...runtimeConfigHealth.problems.map((problem) => `Config drift: ${problem}`),
      ...(runtimeConfigHealth.problems.length > 0 ? ["Repair: run /cohesion setup, then /reload"] : []),
      "",
      ...describeCapabilities(snapshot),
      `Meridian refresh: ${formatMeridianRefreshStatus(meridianRefreshStatus)}`,
      "",
      `Active todo: ${snapshot.activeTodoId === undefined ? "none" : `#${snapshot.activeTodoId}`}`,
      `Running workflows: ${running.length === 0 ? "none" : running.join(", ")}`,
      `Herdr session: ${!herdrEnabled ? "not active" : herdrOperational === false ? "failed" : herdrOperational === true ? "connected" : "detecting"}`,
      `Herdr dependency (optional): ${herdrDependency?.status ?? "unchecked"}`,
      ...(herdrDependency && herdrDependency.status !== "ready"
        ? [herdrDependency.message, ...(herdrDependency.details ? [herdrDependency.details] : [])]
        : []),
      "",
      "Config",
      configStatus(APPEND_SYSTEM_TARGET, appendSystemConfigured()),
      configStatus(BETTER_COMPACTION_CONFIG, Boolean(readJson(BETTER_COMPACTION_CONFIG))),
      configStatus(SERVICE_TIER_CONFIG, Boolean(readJson(SERVICE_TIER_CONFIG))),
      configStatus(WORKFLOW_TIERS_CONFIG, Boolean(readJson(WORKFLOW_TIERS_CONFIG))),
      configStatus(FABRIC_CONFIG, Boolean(readJson(FABRIC_CONFIG))),
      configStatus(WORKFLOW_SETTINGS_CONFIG, Boolean(readJson(WORKFLOW_SETTINGS_CONFIG))),
    ];
    return lines.join("\n");
  }

  pi.on("before_agent_start", (event) => {
    const systemPrompt = appendPiHaziqContract(event.systemPrompt, APPEND_SYSTEM_POLICY);
    return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
  });

  pi.registerCommand("cohesion", {
    description: "Inspect Haziq cross-extension health, capabilities, and recent events",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "events") {
        const recent = eventLog.slice(-15).map((event) => JSON.stringify(event));
        ctx.ui.notify(recent.length > 0 ? recent.join("\n") : "No cohesion events recorded", "info");
        return;
      }
      if (action === "reload") {
        await ctx.reload();
        return;
      }
      if (action === "contract") {
        const options = ctx.getSystemPromptOptions();
        const append = typeof options.appendSystemPrompt === "string" ? options.appendSystemPrompt : "";
        const loadedFromAppend =
          hasPiHaziqContract(append, APPEND_SYSTEM_POLICY) ||
          hasPiHaziqContract(ctx.getSystemPrompt(), APPEND_SYSTEM_POLICY);
        ctx.ui.notify(
          `pi-haziq contract: ${loadedFromAppend ? "loaded" : "extension fallback ready"} · ${APPEND_SYSTEM_TARGET}`,
          "info",
        );
        return;
      }
      if (action === "setup" || action.startsWith("setup ")) {
        const setupAction = action.slice("setup".length).trim();
        if (setupAction && setupAction !== "check") {
          ctx.ui.notify("Usage: /cohesion setup [check]", "warning");
          return;
        }
        try {
          const operations = await planSetup(SETUP_PATHS);
          const report = formatSetupPlan(operations);
          const changed = operations.filter((operation) => operation.status !== "unchanged");
          const herdrBefore = await refreshHerdrDependency();
          const herdrReport = formatHerdrDependencyReport(herdrBefore);
          // Optional only: install integration when CLI exists and integration file is missing.
          const herdrNeedsWork = herdrBefore.status === "missing-integration";
          if (setupAction === "check") {
            ctx.ui.notify(
              [report, "", herdrReport].join("\n"),
              changed.length === 0 && !herdrNeedsWork ? "info" : "warning",
            );
            return;
          }
          if (changed.length === 0 && !herdrNeedsWork) {
            ctx.ui.notify([report, "", herdrReport].join("\n"), "info");
            return;
          }
          if (!ctx.hasUI) {
            ctx.ui.notify(
              `${report}\n\n${herdrReport}\n\nInteractive confirmation is required to apply setup.`,
              "warning",
            );
            return;
          }
          const confirmed = await ctx.ui.confirm(
            "Apply pi-haziq setup?",
            [
              report,
              "",
              herdrReport,
              "",
              "Existing changed files are backed up. Provider credentials and auth files are never touched.",
              herdrBefore.status === "missing-binary"
                ? "Herdr CLI not installed (optional). Default Fabric agent transport is process."
                : herdrNeedsWork
                  ? "Optional: if you confirm, setup will run: herdr integration install pi"
                  : "Herdr dependency is already ready.",
            ].join("\n"),
          );
          if (!confirmed) {
            ctx.ui.notify("pi-haziq setup cancelled; no files changed.", "info");
            return;
          }
          const applied = changed.length > 0 ? await applySetup(operations) : [];
          let herdrAfterReport = herdrReport;
          if (herdrNeedsWork && herdrBefore.status !== "missing-binary") {
            const ensured = await ensureHerdrIntegration({
              agentDir: SETUP_PATHS.agentDir,
              exec: async (file, args, options) => {
                const result = await pi.exec(file, args, { timeout: options?.timeout ?? 60_000 });
                return {
                  code: result.code,
                  stdout: result.stdout ?? "",
                  stderr: result.stderr ?? "",
                  killed: result.killed,
                };
              },
              force: herdrBefore.status === "missing-integration",
            });
            herdrDependency = ensured.report;
            herdrAfterReport = formatHerdrDependencyReport(ensured.report);
          } else {
            await refreshHerdrDependency();
            herdrAfterReport = herdrDependency
              ? formatHerdrDependencyReport(herdrDependency)
              : herdrReport;
          }
          refreshRuntimeConfigHealth();
          ctx.ui.notify(
            [
              `pi-haziq setup applied ${applied.length} change${applied.length === 1 ? "" : "s"}.`,
              ...applied.map((operation) =>
                `- ${operation.status} ${operation.target}${operation.backup ? ` · backup ${operation.backup}` : ""}`
              ),
              "",
              herdrAfterReport,
              "Run /reload, then /cohesion doctor.",
            ].join("\n"),
            herdrDependency?.status === "ready" || herdrDependency?.status === undefined ? "info" : "warning",
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`pi-haziq setup failed safely: ${message}`, "error");
        }
        return;
      }
      if (action === "doctor" || action === "status") {
        refreshToolHealth();
        refreshRuntimeConfigHealth();
        await refreshHerdrDependency();
        refreshCapabilities(ctx);
        updateStatus(ctx);
        queueHerdrMetadata();
        const healthy =
          toolHealth.status === "healthy" && runtimeConfigHealth.status === "healthy";
        // Herdr is optional enrichment; missing CLI does not fail package health.
        ctx.ui.notify(doctorReport(), healthy ? "info" : "warning");
        return;
      }
      ctx.ui.notify("Usage: /cohesion [status|doctor|events|contract|reload|setup [check]]", "warning");
    },
  });

  pi.on("session_start", (event, ctx) => {
    shuttingDown = false;
    activeContext = ctx;
    restoreBranchState(ctx);
    refreshToolHealth();
    refreshRuntimeConfigHealth();
    persist();
    updateStatus(ctx);
    queueHerdrMetadata();
    emit("haziq:session-started", "pi", {
      reason: event.reason,
      health: toolHealth.status === "healthy" && runtimeConfigHealth.status === "healthy" ? "healthy" : "degraded",
      missingTools: toolHealth.missing,
      runtimeConfigProblems: runtimeConfigHealth.problems,
    });
    if (toolHealth.status === "degraded" && ctx.hasUI) {
      ctx.ui.notify(`Haziq cohesion degraded; missing tools: ${toolHealth.missing.join(", ")}`, "warning");
    }
  });

  pi.on("session_tree", (event, ctx) => {
    activeContext = ctx;
    pendingTodoCandidates.clear();
    pendingTodoClearsActive = false;
    workflowTodoByCall.clear();
    restoreBranchState(ctx);
    updateStatus(ctx);
    queueHerdrMetadata();
    emit("haziq:session-tree-changed", "pi", {
      oldLeafId: event.oldLeafId,
      newLeafId: event.newLeafId,
    });
  });

  pi.on("model_select", (event, ctx) => {
    activeContext = ctx;
    refreshCapabilities(ctx);
    persist();
    emit("haziq:model-changed", "pi", {
      source: event.source,
      previousModel: event.previousModel ? `${event.previousModel.provider}/${event.previousModel.id}` : undefined,
      capabilities: snapshot.capabilities,
    });
    queueHerdrMetadata();
  });

  pi.on("thinking_level_select", (event, ctx) => {
    activeContext = ctx;
    emit("haziq:thinking-changed", "pi", { level: event.level, previousLevel: event.previousLevel });
    queueHerdrMetadata();
  });

  pi.on("turn_start", () => {
    pendingTodoCandidates.clear();
    pendingTodoClearsActive = false;
    workflowTodoByCall.clear();
  });

  pi.on("tool_execution_start", (event, ctx) => {
    activeContext = ctx;
    if (event.toolName === "todo" && event.args && typeof event.args === "object") {
      const args = event.args as { action?: unknown; id?: unknown; status?: unknown };
      if (args.action === "update" && typeof args.id === "number") {
        if (args.status === "in_progress") pendingTodoCandidates.add(args.id);
        if (
          args.id === snapshot.activeTodoId &&
          (args.status === "pending" || args.status === "completed" || args.status === "deleted")
        ) {
          pendingTodoClearsActive = true;
        }
      }
    }
    if (event.toolName === "workflow") {
      const todoId = pendingTodoClearsActive
        ? selectWorkflowTodoId(undefined, pendingTodoCandidates)
        : selectWorkflowTodoId(snapshot.activeTodoId, pendingTodoCandidates);
      workflowTodoByCall.set(event.toolCallId, todoId);
      emit("haziq:workflow-requested", "workflow", { toolCallId: event.toolCallId }, { taskId: todoId });
    } else if (mcpToolNames.has(event.toolName)) {
      emit("haziq:mcp-started", "mcp", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        descriptor: mcpDescriptor(event.args),
      });
    }
  });

  pi.on("tool_result", (event, ctx) => {
    activeContext = ctx;
    if (event.toolName === "todo") {
      const previousTodoId = snapshot.activeTodoId;
      snapshot = { ...snapshot, activeTodoId: activeTodoIdFromDetails(event.details) };
      if (snapshot.activeTodoId !== previousTodoId) persist();
      emit("haziq:todo-changed", "todo", {
        action: recordDetails(event.details).action,
        activeTodoId: snapshot.activeTodoId,
        allDone: allVisibleTodosCompleted(event.details),
      }, { taskId: snapshot.activeTodoId });
      if (allVisibleTodosCompleted(event.details)) {
        emit("haziq:all-work-completed", "todo", {});
      }
      updateStatus();
      queueHerdrMetadata();
      return undefined;
    }

    if (event.toolName === "workflow_control" && !event.isError) {
      const details = recordDetails(event.details);
      const run = recordDetails(details.run);
      const runId = typeof run.runId === "string" ? run.runId : undefined;
      const status = normalizeWorkflowStatus(run.status);
      if (runId && status) {
        const existing = snapshot.workflows[runId];
        upsertRun({
          runId,
          todoId: existing?.todoId,
          toolCallId: existing?.toolCallId,
          background: existing?.background,
          status,
        });
        emit(`haziq:workflow-${status}`, "workflow", {
          action: details.action,
          result: details.result,
        }, { runId, taskId: existing?.todoId });
      }
      return undefined;
    }

    if (event.toolName !== "workflow" || event.isError) return undefined;
    const runId = extractWorkflowRunId(event.details, event.content);
    if (!runId) {
      workflowTodoByCall.delete(event.toolCallId);
      return undefined;
    }
    const details = recordDetails(event.details);
    const background = details.background === true;
    const link: WorkflowLink = {
      runId,
      toolCallId: event.toolCallId,
      todoId: workflowTodoByCall.get(event.toolCallId),
      status: background ? "running" : "completed",
      background,
      updatedAt: Date.now(),
    };
    workflowTodoByCall.delete(event.toolCallId);
    upsertRun(link);
    emit(background ? "haziq:workflow-started" : "haziq:workflow-completed", "workflow", {
      toolCallId: event.toolCallId,
      background,
    }, { runId, taskId: link.todoId });

    const note = link.todoId === undefined
      ? `Haziq cohesion: tracking workflow ${runId}.`
      : `Haziq cohesion: linked workflow ${runId} to todo #${link.todoId}. Verify delivered results before completing the todo.`;
    return {
      content: [...event.content, { type: "text" as const, text: note }],
      details: {
        ...details,
        haziqCohesion: { runId, todoId: link.todoId },
      },
    };
  });

  pi.on("tool_execution_end", (event, ctx) => {
    activeContext = ctx;
    if (event.toolName === "workflow" && event.isError) {
      const todoId = workflowTodoByCall.get(event.toolCallId);
      workflowTodoByCall.delete(event.toolCallId);
      emit("haziq:workflow-request-failed", "workflow", {
        toolCallId: event.toolCallId,
      }, { taskId: todoId });
    } else if (event.toolName === "workflow_control") {
      emit("haziq:workflow-control", "workflow", {
        toolCallId: event.toolCallId,
        failed: event.isError,
      });
    } else if (mcpToolNames.has(event.toolName)) {
      emit(event.isError ? "haziq:mcp-failed" : "haziq:mcp-completed", "mcp", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      }, { taskId: snapshot.activeTodoId });
    } else if (event.toolName === "start_loop") {
      emit("haziq:loop-changed", "loop", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        failed: event.isError,
      }, { taskId: snapshot.activeTodoId });
    }
  });

  pi.on("message_end", (event, ctx) => {
    activeContext = ctx;
    if (
      event.message.role !== "custom" ||
      event.message.customType !== "workflow-result" ||
      typeof event.message.content !== "string"
    ) {
      return undefined;
    }
    const message = event.message;
    const content = message.content as string;
    const delivery = extractWorkflowDelivery(content);
    if (!delivery) return undefined;
    const link = workflowByRunId(delivery.runId);
    if (!link) {
      emit("haziq:workflow-delivery-unmatched", "workflow", { status: delivery.status, runId: delivery.runId });
      return undefined;
    }
    upsertRun({ ...link, status: delivery.status });
    const channel = delivery.status === "completed"
      ? "haziq:workflow-completed"
      : delivery.status === "failed"
        ? "haziq:workflow-failed"
        : "haziq:workflow-paused";
    emit(channel, "workflow", {}, { runId: link.runId, taskId: link.todoId });
    notifyHerdr(
      delivery.status === "completed" ? "Workflow complete" : `Workflow ${delivery.status}`,
      `${link.runId}${link.todoId === undefined ? "" : ` · todo #${link.todoId}`}`,
      delivery.status === "completed" ? "done" : "request",
    );
    const instruction = workflowInstruction(link, delivery.status);
    return {
      message: {
        ...message,
        content: `${content}\n\n${instruction}`,
        details: {
          ...recordDetails(message.details),
          haziqCohesion: { runId: link.runId, todoId: link.todoId, status: delivery.status },
        },
      },
    };
  });

  pi.on("session_compact", (event, ctx) => {
    activeContext = ctx;
    const details = recordDetails(event.compactionEntry.details);
    const native = typeof details.strategy === "string";
    const strategy = native
      ? "native-responses"
      : event.fromExtension
        ? "delegated-model"
        : "pi-default";
    emit("haziq:compaction-completed", "compaction", {
      reason: event.reason,
      strategy,
      tokensBefore: event.compactionEntry.tokensBefore,
      willRetry: event.willRetry,
    });
    queueHerdrMetadata();
  });

  pi.on("before_provider_request", (event, ctx) => {
    activeContext = ctx;
    const payload = recordDetails(event.payload);
    const tier = typeof payload.service_tier === "string" ? payload.service_tier : undefined;
    const capabilities = snapshot.capabilities;
    const previousActive = capabilities?.serviceTier;
    const previousTier = capabilities?.serviceTierName;
    if (capabilities && (previousActive !== Boolean(tier) || previousTier !== tier)) {
      snapshot = {
        ...snapshot,
        capabilities: {
          ...capabilities,
          serviceTier: Boolean(tier),
          serviceTierName: tier,
        },
      };
      persist();
      emit("haziq:service-tier-observed", "service-tier", {
        active: Boolean(tier),
        tier,
        model: capabilities.model,
      });
      queueHerdrMetadata();
    }
    return undefined;
  });

  pi.on("after_provider_response", (event, ctx) => {
    activeContext = ctx;
    if (event.status === 429) {
      emit("haziq:provider-rate-limited", "provider", {
        model: snapshot.capabilities?.model,
        retryAfter: event.headers["retry-after"],
      });
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    activeContext = ctx;
    updateStatus(ctx);
    queueHerdrMetadata();
    emit("haziq:agent-settled", "pi", {});
  });

  pi.on("session_info_changed", (_event, ctx) => {
    activeContext = ctx;
    queueHerdrMetadata();
  });

  pi.on("session_shutdown", async (event) => {
    shuttingDown = true;
    herdrMetadataQueued = false;
    unsubscribeMeridianRefresh?.();
    unsubscribeMeridianRefresh = undefined;
    unsubscribeFabricCapturedTools?.();
    unsubscribeFabricCapturedTools = undefined;
    if (event.reason === "quit" && herdrEnabled && process.env.HERDR_PANE_ID) {
      try {
        await executeHerdr([
          "pane",
          "report-metadata",
          process.env.HERDR_PANE_ID,
          "--source",
          "haziq:cohesion",
          "--clear-token",
          "model",
          "--clear-token",
          "api",
          "--clear-token",
          "thinking",
          "--clear-token",
          "todo",
          "--clear-token",
          "workflow",
          "--clear-token",
          "workflow_count",
          "--clear-token",
          "compaction",
          "--clear-token",
          "compaction_model",
          "--clear-token",
          "cohesion",
        ], "pane.report-metadata.clear");
      } catch (error) {
        reportHerdrFailure("pane.report-metadata.clear", error);
      }
    }
    activeContext = undefined;
  });
}
