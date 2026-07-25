import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_TOOLS,
  STATE_ENTRY_TYPE,
  activeTodoIdFromDetails,
  allVisibleTodosCompleted,
  createSnapshot,
  deriveCapabilities,
  extractWorkflowDelivery,
  extractWorkflowRunId,
  inspectTools,
  restoreLatestSnapshot,
  runningWorkflowIds,
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
  const health = inspectTools(["todo", "workflow", "mcp"]);
  assert.equal(health.status, "degraded");
  assert.deepEqual(health.present, ["todo", "workflow", "mcp"]);
  assert.ok(health.missing.includes("workflow_control"));

  const complete = inspectTools(EXPECTED_TOOLS);
  assert.equal(complete.status, "healthy");
  assert.deepEqual(complete.missing, []);
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
