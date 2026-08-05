import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendPiHaziqContract, hasPiHaziqContract } from "../src/contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the extension composes the package contract when project or CLI append text shadows the global file", async () => {
  const policy = await readFile(join(root, "APPEND_SYSTEM.md"), "utf8");
  const projectPrompt = "base system\n\n# project-specific appended policy";
  const composed = appendPiHaziqContract(projectPrompt, policy);
  assert.equal(hasPiHaziqContract(projectPrompt, policy), false);
  assert.equal(hasPiHaziqContract(`${projectPrompt}\n\n# pi-haziq operating contract`, policy), false, "heading-only collisions must not suppress injection");
  assert.equal(hasPiHaziqContract(composed, policy), true);
  assert.match(composed, /project-specific appended policy/);
  assert.equal(appendPiHaziqContract(composed, policy), composed, "contract must not duplicate across turns or reloads");
});

test("APPEND_SYSTEM routes casual pi-subagents vs Dynamic fleets and freezes efficient planning", async () => {
  const policy = await readFile(join(root, "APPEND_SYSTEM.md"), "utf8");
  assert.match(policy, /## Subagent package routing/);
  assert.match(policy, /Use `pi-subagents` for casual delegation/);
  assert.match(policy, /Use Dynamic Workflows for fleet orchestration/);
  assert.match(policy, /extensions\.subagent/);
  assert.match(policy, /extensions\.subagent_wait/);
  assert.match(policy, /extensions\.workflow/);
  assert.match(policy, /extensions\.workflow_control/);
  assert.match(policy, /Do not invent a Dynamic workflow script for these jobs/);
  assert.match(policy, /Do not run both for the same work/);
  assert.match(policy, /never use Fabric agents/i);
  const guidance = policy
    .match(/When a non-trivial build outcome is clear,[\s\S]+?(?=\n\n## Authoring and publication)/)?.[0]
    .trim();
  const expected = [
    "When a non-trivial build outcome is clear, first run a bounded planning pass to identify the most efficient safe path, explicitly considering casual `pi-subagents` delegation, Dynamic Workflows for fleets, recursive decomposition only for context overflow, parallel subagents, critical-path dependencies, coordination cost, and proof gates.",
    "Sequence implementation risk-first through contracts and a thin end-to-end slice, parallelize only isolated work, integrate and verify continuously, and prefer the plan that minimizes expected wall-clock time, compute, coordination, and rework—even when that plan is one agent working directly.",
  ].join(" ");
  assert.equal(guidance, expected, "efficient build-path guidance must remain exact and complete");
  assert.equal(guidance.match(/[.!?](?: |$)/g)?.length, 2, "guidance must remain exactly two sentences");
});

test("APPEND_SYSTEM freezes the approved update, reload, setup, publication, and secret boundaries", async () => {
  const policy = await readFile(join(root, "APPEND_SYSTEM.md"), "utf8");
  assert.match(policy, /<!-- PI_HAZIQ_CONTRACT_V1 -->/);
  assert.match(policy, /PI_OFFLINE[\s\S]*do \*\*not\*\* run the update command/);
  assert.match(policy, /pi update --extension git:github\.com\/haziqazizi\/pi-haziq/);
  assert.match(policy, /Regardless of the update command's exit status[\s\S]*before != after/);
  assert.match(policy, /\/reload/);
  assert.match(policy, /\/cohesion setup/);
  assert.match(policy, /Never edit Pi's managed clone/);
  assert.match(policy, /publish or update a pull request/);
  assert.match(policy, /merge only with explicit authority and green evidence/);
  assert.match(policy, /Never commit or print credentials/);
  assert.match(policy, /Herdr is optional/);
});

test("APPEND_SYSTEM names the captured tool refs it requires, not bare tool names", async () => {
  const policy = await readFile(join(root, "APPEND_SYSTEM.md"), "utf8");
  const tooling = policy.match(/<!-- PI_HAZIQ_TOOLING_V1 -->[\s\S]+?<!-- \/PI_HAZIQ_TOOLING_V1 -->/)?.[0] ?? "";
  assert.notEqual(tooling, "", "tooling block must remain present");
  assert.match(tooling, /captured by Fabric and may not appear in the model's tool list/, "the block must explain why bare tool names are unreachable");
  assert.match(tooling, /tools\.search\(\{ query \}\)/, "agents must be told how to resolve an unknown ref");
  for (const ref of [
    "extensions.todo({ action: 'create', subject, activeForm })",
    "extensions.todo({ action: 'update', id, status })",
    "extensions.subagent",
    "extensions.subagent_wait",
    "extensions.workflow",
    "extensions.workflow_control",
    "extensions.web_search",
    "extensions.fetch_content",
    "extensions.get_search_content",
    "extensions.agent_browser",
  ]) {
    assert.ok(tooling.includes(ref), `tooling block must name the callable ref: ${ref}`);
  }
  assert.equal(/\buse the todo tool\b/i.test(tooling), false, "bare 'the todo tool' phrasing names no callable ref");
});
