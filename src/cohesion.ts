export const COHESION_VERSION = 1;
export const STATE_ENTRY_TYPE = "haziq-cohesion-state";

export const EXPECTED_TOOLS = [
  "todo",
  "mcp",
  "LoopCreate",
  "LoopList",
  "LoopDelete",
  "schedule_loop_wakeup",
  "workflow",
  "workflow_control",
] as const;

export type CohesionHealth = "healthy" | "degraded";
export type WorkflowStatus = "running" | "completed" | "failed" | "paused" | "stopped";
export type CompactionStrategy = "native-responses" | "delegated-model" | "pi-default";

export interface ModelLike {
  provider?: string;
  id?: string;
  api?: string;
  reasoning?: boolean;
  input?: string[];
}

export interface CompactionConfigLike {
  enabled?: boolean;
  compactionModel?: string;
  responsesCompactApis?: string[];
}

export interface ServiceTierConfigLike {
  active?: boolean;
  serviceTier?: string;
  supportedModels?: string[];
}

export interface CapabilitySnapshot {
  model?: string;
  api?: string;
  reasoning: boolean;
  images: boolean;
  nativeCompaction: boolean;
  delegatedCompaction: boolean;
  compactionModel?: string;
  compactionStrategy: CompactionStrategy;
  serviceTier: boolean;
  serviceTierName?: string;
}

export interface ToolHealth {
  status: CohesionHealth;
  expected: string[];
  present: string[];
  missing: string[];
}

export interface RuntimeConfigurationHealth {
  status: CohesionHealth;
  problems: string[];
}

function nestedValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function inspectRuntimeConfiguration(
  fabric: unknown,
  workflow: unknown,
): RuntimeConfigurationHealth {
  const problems: string[] = [];
  const expect = (source: unknown, path: string[], expected: unknown, label: string) => {
    if (JSON.stringify(nestedValue(source, path)) !== JSON.stringify(expected)) problems.push(label);
  };
  expect(fabric, ["configVersion"], 1, "Fabric configVersion must be 1");
  expect(fabric, ["fullCodeMode"], true, "Fabric fullCodeMode must be enabled");
  expect(fabric, ["agents", "enabled"], true, "Fabric agents must be enabled");
  expect(fabric, ["mesh", "enabled"], false, "Fabric mesh must be disabled");
  expect(fabric, ["capture", "enabled"], true, "Fabric capture must be enabled");
  expect(fabric, ["capture", "hideFromModel"], true, "Fabric captured tools must be hidden");
  expect(fabric, ["capture", "keepVisible"], ["fabric_exec"], "Only fabric_exec may stay visible");
  expect(fabric, ["capture", "risks", "workflow"], "agent", "Workflow launch risk must be agent");
  expect(fabric, ["capture", "risks", "workflow_control"], "execute", "Workflow control risk must be execute");
  expect(workflow, ["keywordTriggerEnabled"], false, "Dynamic keyword trigger must be disabled");
  return { status: problems.length === 0 ? "healthy" : "degraded", problems };
}

export interface WorkflowLink {
  runId: string;
  toolCallId?: string;
  todoId?: number;
  status: WorkflowStatus;
  background?: boolean;
  updatedAt: number;
}

export interface CohesionSnapshot {
  version: number;
  sessionId?: string;
  cwd?: string;
  activeTodoId?: number;
  workflows: Record<string, WorkflowLink>;
  capabilities?: CapabilitySnapshot;
}

export interface NormalizedEvent<T = unknown> {
  version: number;
  timestamp: number;
  sessionId?: string;
  projectId?: string;
  source: string;
  runId?: string;
  taskId?: number;
  data: T;
}

export interface WorkflowDelivery {
  runId?: string;
  status: Exclude<WorkflowStatus, "running" | "stopped">;
}

const RESPONSES_APIS = new Set(["openai-responses", "openai-codex-responses"]);

export function execResultSucceeded(result: { code: number; killed?: boolean }): boolean {
  return result.code === 0 && result.killed !== true;
}

export function canonicalModel(model: ModelLike | undefined): string | undefined {
  if (!model?.provider || !model.id) return undefined;
  return `${model.provider}/${model.id}`;
}

export function deriveCapabilities(
  model: ModelLike | undefined,
  compaction: CompactionConfigLike = {},
  serviceTier: ServiceTierConfigLike = {},
): CapabilitySnapshot {
  const modelKey = canonicalModel(model);
  const compactApis = new Set(compaction.responsesCompactApis ?? [...RESPONSES_APIS]);
  const nativeCompaction =
    compaction.enabled !== false && typeof model?.api === "string" && RESPONSES_APIS.has(model.api) && compactApis.has(model.api);
  const delegatedCompaction =
    compaction.enabled !== false &&
    typeof compaction.compactionModel === "string" &&
    compaction.compactionModel.length > 0 &&
    compaction.compactionModel !== modelKey;
  const serviceTierEnabled =
    serviceTier.active === true &&
    typeof modelKey === "string" &&
    (serviceTier.supportedModels ?? []).includes(modelKey);

  return {
    model: modelKey,
    api: model?.api,
    reasoning: model?.reasoning === true,
    images: Array.isArray(model?.input) && model.input.includes("image"),
    nativeCompaction,
    delegatedCompaction,
    compactionModel: compaction.compactionModel,
    compactionStrategy: nativeCompaction
      ? "native-responses"
      : delegatedCompaction
        ? "delegated-model"
        : "pi-default",
    serviceTier: serviceTierEnabled,
    serviceTierName: serviceTierEnabled ? (serviceTier.serviceTier ?? "priority") : undefined,
  };
}

export function inspectTools(toolNames: Iterable<string>): ToolHealth {
  const available = new Set(toolNames);
  const present = EXPECTED_TOOLS.filter((name) => available.has(name));
  const missing = EXPECTED_TOOLS.filter((name) => !available.has(name));
  return {
    status: missing.length === 0 ? "healthy" : "degraded",
    expected: [...EXPECTED_TOOLS],
    present,
    missing,
  };
}

export function formatCohesionStatus(input: {
  missingTools: readonly string[];
  configProblems: readonly string[];
  activeWorkflowRuns: number;
}): string | undefined {
  const missingTools = [...input.missingTools];
  const configProblems = [...input.configProblems];
  const parts: string[] = [];

  if (missingTools.length > 0) {
    const shown = missingTools.slice(0, 3).join(",");
    const extra = missingTools.length > 3 ? `+${missingTools.length - 3}` : "";
    parts.push(`tools:${shown}${extra}`);
  }
  if (configProblems.length > 0) {
    parts.push(`cfg:${configProblems.length}`);
  }
  if (parts.length > 0) return `cohesion !${parts.join(" ")}`;
  if (input.activeWorkflowRuns > 0) return `cohesion · wf ${input.activeWorkflowRuns}`;
  return undefined;
}

export function textFromToolContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type: "text"; text: string } => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string";
    })
    .map((item) => item.text)
    .join("\n");
}

export function extractWorkflowRunId(details: unknown, content?: unknown): string | undefined {
  if (details && typeof details === "object") {
    const runId = (details as { runId?: unknown }).runId;
    if (typeof runId === "string" && runId.length > 0) return runId;
  }
  const text = typeof content === "string" ? content : textFromToolContent(content);
  const direct = text.match(/\bRun ID:\s*([^\s]+)/i)?.[1];
  return direct || undefined;
}

export function extractWorkflowDelivery(content: string): WorkflowDelivery | undefined {
  if (/^✓\s+Background workflow\b/m.test(content)) {
    const resultPath = content.match(/Full result:\s*([^\n]+\.json)\s*$/im)?.[1]?.trim();
    const runId = resultPath?.match(/[/\\]([^/\\\s]+)\.json$/)?.[1];
    return { runId, status: "completed" };
  }

  const failed = content.match(/✗\s+Background workflow\s+([^\s]+)\s+failed:/i);
  if (failed) return { runId: failed[1], status: "failed" };

  const paused = content.match(/⏸\s+Background workflow\s+([^\s]+)\s+paused:/i);
  if (paused) return { runId: paused[1], status: "paused" };

  return undefined;
}

export function selectWorkflowTodoId(activeTodoId: number | undefined, pendingCandidates: Iterable<number>): number | undefined {
  const candidates = [...new Set(pendingCandidates)];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return undefined;
  return activeTodoId;
}

export function normalizeWorkflowStatus(status: unknown): WorkflowStatus | undefined {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "paused":
    case "pending":
      return "paused";
    case "aborted":
      return "stopped";
    default:
      return undefined;
  }
}

export function activeTodoIdFromDetails(details: unknown): number | undefined {
  if (!details || typeof details !== "object") return undefined;
  const tasks = (details as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return undefined;
  const active = tasks.filter((task) => {
    if (!task || typeof task !== "object") return false;
    return (task as { status?: unknown }).status === "in_progress";
  });
  if (active.length !== 1) return undefined;
  const id = (active[0] as { id?: unknown }).id;
  return typeof id === "number" ? id : undefined;
}

export function allVisibleTodosCompleted(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const tasks = (details as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return false;
  const visible = tasks.filter((task) => {
    if (!task || typeof task !== "object") return false;
    return (task as { status?: unknown }).status !== "deleted";
  });
  return visible.length > 0 && visible.every((task) => (task as { status?: unknown }).status === "completed");
}

export function createSnapshot(partial: Partial<CohesionSnapshot> = {}): CohesionSnapshot {
  return {
    ...partial,
    version: COHESION_VERSION,
    workflows: { ...(partial.workflows ?? {}) },
  };
}

export function restoreLatestSnapshot(entries: unknown[]): CohesionSnapshot {
  let snapshot = createSnapshot();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (candidate.type !== "custom" || candidate.customType !== STATE_ENTRY_TYPE) continue;
    if (!candidate.data || typeof candidate.data !== "object") continue;
    const data = candidate.data as Partial<CohesionSnapshot>;
    if (data.version !== COHESION_VERSION) continue;
    snapshot = createSnapshot(data);
  }
  return snapshot;
}

export function upsertWorkflow(
  snapshot: CohesionSnapshot,
  link: Omit<WorkflowLink, "updatedAt"> & { updatedAt?: number },
): CohesionSnapshot {
  return {
    ...snapshot,
    workflows: {
      ...snapshot.workflows,
      [link.runId]: {
        ...snapshot.workflows[link.runId],
        ...link,
        updatedAt: link.updatedAt ?? Date.now(),
      },
    },
  };
}

export function runningWorkflowIds(snapshot: CohesionSnapshot): string[] {
  return Object.values(snapshot.workflows)
    .filter((workflow) => workflow.status === "running")
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .map((workflow) => workflow.runId);
}

export function makeEvent<T>(
  snapshot: CohesionSnapshot,
  source: string,
  data: T,
  options: { runId?: string; taskId?: number; timestamp?: number } = {},
): NormalizedEvent<T> {
  return {
    version: COHESION_VERSION,
    timestamp: options.timestamp ?? Date.now(),
    sessionId: snapshot.sessionId,
    projectId: snapshot.cwd,
    source,
    runId: options.runId,
    taskId: options.taskId,
    data,
  };
}

export function workflowInstruction(link: WorkflowLink, status: WorkflowDelivery["status"]): string {
  const todo = link.todoId === undefined ? "the active task" : `todo #${link.todoId}`;
  if (status === "completed") {
    return `Haziq cohesion: workflow ${link.runId} is linked to ${todo}. Verify the delivered result at the closest faithful surface before marking that todo completed.`;
  }
  if (status === "paused") {
    return `Haziq cohesion: workflow ${link.runId} linked to ${todo} paused. Keep the todo in progress and record a blocker only if no automatic/provider recovery remains.`;
  }
  return `Haziq cohesion: workflow ${link.runId} linked to ${todo} failed. Do not complete the todo; preserve the failure and create or attach a blocker.`;
}
