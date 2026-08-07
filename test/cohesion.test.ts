import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_TOOLS,
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
  normalizeWorkflowStatus,
  restoreLatestSnapshot,
  runningWorkflowIds,
  selectWorkflowTodoId,
  upsertWorkflow,
  workflowInstruction,
} from "../src/cohesion.ts";

test("derives delegated compaction for an Anthropic main model", () => {
  const capabilities = deriveCapabilities(
    {
      provider: "meridian",
      id: "claude-opus-5",
      api: "anthropic-messages",
      reasoning: true,
      input: ["text", "image"],
    },
    {
      enabled: true,
      compactionModel: "tokenmaxxing/gpt-5.6-sol",
      responsesCompactApis: ["openai-responses", "openai-codex-responses"],
    },
    {
      active: true,
      serviceTier: "priority",
      supportedModels: ["tokenmaxxing/gpt-5.6-sol"],
    },
  );

  assert.equal(capabilities.model, "meridian/claude-opus-5");
  assert.equal(capabilities.nativeCompaction, false);
  assert.equal(capabilities.delegatedCompaction, true);
  assert.equal(capabilities.compactionStrategy, "delegated-model");
  assert.equal(capabilities.serviceTier, false);
  assert.equal(capabilities.images, true);
});

test("derives native compaction and service tier for a supported Responses model", () => {
  const capabilities = deriveCapabilities(
    {
      provider: "tokenmaxxing",
      id: "gpt-5.6-sol",
      api: "openai-responses",
      reasoning: true,
      input: ["text", "image"],
    },
    {
      enabled: true,
      compactionModel: "tokenmaxxing/gpt-5.6-sol",
      responsesCompactApis: ["openai-responses", "openai-codex-responses"],
    },
    {
      active: true,
      serviceTier: "priority",
      supportedModels: ["tokenmaxxing/gpt-5.6-sol"],
    },
  );

  assert.equal(capabilities.nativeCompaction, true);
  assert.equal(capabilities.delegatedCompaction, false);
  assert.equal(capabilities.compactionStrategy, "native-responses");
  assert.equal(capabilities.serviceTier, true);
  assert.equal(capabilities.serviceTierName, "priority");
});

test("reports missing expected tools without throwing", () => {
  const health = inspectTools(["todo", "mcp"]);
  assert.equal(health.status, "degraded");
  assert.deepEqual(health.present, ["todo", "mcp"]);
  assert.ok(health.missing.includes("start_loop"));

  const complete = inspectTools(EXPECTED_TOOLS);
  assert.equal(complete.status, "healthy");
  assert.deepEqual(complete.missing, []);
});

test("requires Fabric agents on, mesh on, process-or-herdr transport, and capture policy", () => {
  const healthy = inspectRuntimeConfiguration(
    {
      configVersion: 3,
      fullCodeMode: true,
      agents: {
        enabled: true,
        transport: "process",
        extensions: true,
        defaultTools: ["read", "bash", "edit", "write", "grep", "find", "ls", "todo"],
      },
      mesh: { enabled: true },
      capture: {
        enabled: true,
        hideFromModel: true,
        keepVisible: ["fabric_exec"],
      },
    },
  );
  assert.deepEqual(healthy, { status: "healthy", problems: [] });
  const drift = inspectRuntimeConfiguration(
    {
      configVersion: 3,
      fullCodeMode: true,
      agents: { enabled: false, transport: "bogus", extensions: false, defaultTools: ["read"] },
      mesh: { enabled: false },
      capture: { enabled: true, hideFromModel: false, keepVisible: ["fabric_exec", "todo"] },
    },
  );
  assert.equal(drift.status, "degraded");
  assert.ok(drift.problems.some((problem) => /Fabric agents must be enabled/.test(problem)));
  assert.ok(drift.problems.some((problem) => /transport must be process \(default\) or herdr/.test(problem)));
  assert.ok(drift.problems.some((problem) => /mesh must be enabled/.test(problem)));
  assert.ok(drift.problems.some((problem) => /Only fabric_exec/.test(problem)));
  assert.ok(drift.problems.some((problem) => /defaultTools must include bash/.test(problem)));
});

test("extracts workflow run IDs from typed details and fallback text", () => {
  assert.equal(extractWorkflowRunId({ runId: "wf_details" }), "wf_details");
  assert.equal(
    extractWorkflowRunId(undefined, [{ type: "text", text: "Workflow started\nRun ID: wf_text" }]),
    "wf_text",
  );
});

test("extracts completed, failed, and paused background deliveries", () => {
  assert.deepEqual(
    extractWorkflowDelivery(
      '✓ Background workflow "review" finished (3 agents).\n\nok\n\n↳ Full result: /tmp/project/runs/wf_done.json',
    ),
    { runId: "wf_done", status: "completed" },
  );
  assert.deepEqual(extractWorkflowDelivery("✗ Background workflow wf_bad failed: boom"), {
    runId: "wf_bad",
    status: "failed",
  });
  assert.deepEqual(extractWorkflowDelivery("⏸ Background workflow wf_wait paused: usage limit"), {
    runId: "wf_wait",
    status: "paused",
  });
});

test("selects workflow todo deterministically and declines ambiguous pending links", () => {
  assert.equal(selectWorkflowTodoId(4, []), 4);
  assert.equal(selectWorkflowTodoId(4, [7]), 7);
  assert.equal(selectWorkflowTodoId(4, [7, 8]), undefined);
  assert.equal(selectWorkflowTodoId(4, [7, 7]), 7);
});

test("normalizes public workflow control statuses", () => {
  assert.equal(normalizeWorkflowStatus("running"), "running");
  assert.equal(normalizeWorkflowStatus("paused"), "paused");
  assert.equal(normalizeWorkflowStatus("pending"), "paused");
  assert.equal(normalizeWorkflowStatus("aborted"), "stopped");
  assert.equal(normalizeWorkflowStatus("unknown"), undefined);
});

test("classifies Herdr command results without trusting environment presence", () => {
  assert.equal(execResultSucceeded({ code: 0, killed: false }), true);
  assert.equal(execResultSucceeded({ code: 1, killed: false }), false);
  assert.equal(execResultSucceeded({ code: 0, killed: true }), false);
});

test("derives active and completed todo state from public tool details", () => {
  const details = {
    tasks: [
      { id: 1, subject: "Done", status: "completed" },
      { id: 2, subject: "Current", status: "in_progress" },
    ],
  };
  assert.equal(activeTodoIdFromDetails(details), 2);
  assert.equal(allVisibleTodosCompleted(details), false);
  assert.equal(
    allVisibleTodosCompleted({ tasks: [{ id: 1, status: "completed" }, { id: 2, status: "deleted" }] }),
    true,
  );
  assert.equal(
    activeTodoIdFromDetails({ tasks: [{ id: 1, status: "in_progress" }, { id: 2, status: "in_progress" }] }),
    undefined,
  );
});

test("restores only the latest compatible cohesion snapshot", () => {
  const first = createSnapshot({ activeTodoId: 1 });
  const latest = createSnapshot({ activeTodoId: 2 });
  const restored = restoreLatestSnapshot([
    { type: "custom", customType: STATE_ENTRY_TYPE, data: first },
    { type: "custom", customType: STATE_ENTRY_TYPE, data: { version: 999, activeTodoId: 99 } },
    { type: "custom", customType: STATE_ENTRY_TYPE, data: latest },
  ]);
  assert.equal(restored.activeTodoId, 2);
});

test("branch reconstruction does not carry abandoned branch state", () => {
  const branchA = [{ type: "custom", customType: STATE_ENTRY_TYPE, data: createSnapshot({ activeTodoId: 11 }) }];
  const branchB = [{ type: "custom", customType: STATE_ENTRY_TYPE, data: createSnapshot({ activeTodoId: 22 }) }];
  assert.equal(restoreLatestSnapshot(branchA).activeTodoId, 11);
  assert.equal(restoreLatestSnapshot(branchB).activeTodoId, 22);
  assert.equal(restoreLatestSnapshot([]).activeTodoId, undefined);
});

test("tracks workflow state and provides proof-aware instructions", () => {
  let snapshot = createSnapshot();
  snapshot = upsertWorkflow(snapshot, {
    runId: "wf_one",
    todoId: 4,
    status: "running",
    updatedAt: 1,
  });
  snapshot = upsertWorkflow(snapshot, {
    runId: "wf_two",
    status: "completed",
    updatedAt: 2,
  });
  assert.deepEqual(runningWorkflowIds(snapshot), ["wf_one"]);
  assert.match(workflowInstruction(snapshot.workflows.wf_one, "completed"), /Verify/);
  assert.match(workflowInstruction(snapshot.workflows.wf_one, "failed"), /Do not complete/);
});

test("formats quiet cohesion footer status", () => {
  assert.equal(
    formatCohesionStatus({ missingTools: [], configProblems: [], activeWorkflowRuns: 0 }),
    undefined,
  );
  assert.equal(
    formatCohesionStatus({ missingTools: [], configProblems: [], activeWorkflowRuns: 2 }),
    "cohesion · wf 2",
  );
  assert.equal(
    formatCohesionStatus({
      missingTools: ["todo", "mcp"],
      configProblems: ["Fabric agents must be enabled"],
      activeWorkflowRuns: 0,
    }),
    "cohesion !tools:todo,mcp cfg:1",
  );
  assert.equal(
    formatCohesionStatus({
      missingTools: ["a", "b", "c", "d"],
      configProblems: [],
      activeWorkflowRuns: 1,
    }),
    "cohesion !tools:a,b,c+1",
  );
});

