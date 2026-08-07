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

test("APPEND_SYSTEM routes Fabric agents vs Dynamic fleets and freezes efficient planning", async () => {
  const policy = await readFile(join(root, "APPEND_SYSTEM.md"), "utf8");
  assert.match(policy, /## Subagent package routing/);
  assert.match(policy, /Use Fabric agents for casual delegation/);
  assert.match(policy, /Use Dynamic Workflows for fleet orchestration/);
  assert.match(policy, /agents\.run/);
  assert.match(policy, /agents\.spawn/);
  assert.match(policy, /extensions\.workflow/);
  assert.match(policy, /extensions\.workflow_control/);
  assert.match(policy, /Do \*\*not\*\* install or call Nico Bailon/);
  assert.match(policy, /If the Dynamic capability is unavailable for a fleet job, stop/);
  assert.match(
    policy,
    /explicitly considering Fabric agents for casual fanout, Dynamic Workflows for fleets, recursive decomposition only for context overflow, critical-path dependencies, coordination cost, and proof gates\./,
  );
  assert.match(policy, /prefer the plan that minimizes expected wall-clock time, compute, coordination, and rework/);
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
    "agents.run",
    "agents.spawn",
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
