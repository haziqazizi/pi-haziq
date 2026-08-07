import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applySetup, defaultSetupPaths, formatSetupPlan, planSetup, type SetupPaths } from "../src/setup.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(): Promise<{ root: string; paths: SetupPaths }> {
  const root = await mkdtemp(join(tmpdir(), "pi-haziq-setup."));
  const packageRoot = join(root, "package");
  const agentDir = join(root, "home", ".pi", "agent");
  const workflowDir = join(root, "home", ".pi", "workflows");
  await mkdir(join(packageRoot, "config"), { recursive: true });
  await writeFile(join(packageRoot, "APPEND_SYSTEM.md"), "# managed policy\n");
  await writeJson(join(packageRoot, "config", "settings.fragment.json"), {
    enabledModels: ["meridian/claude-fable-5", "tokenmaxxing/gpt-5.6-sol"],
    compaction: { enabled: true, reserveTokens: 16384 },
  });
  await writeJson(join(packageRoot, "config", "pi-better-compaction.json"), {
    enabled: true,
    compactionModel: "tokenmaxxing/gpt-5.6-sol",
  });
  await writeJson(join(packageRoot, "config", "pi-openai-service-tier.json"), {
    active: true,
    serviceTier: "priority",
  });
  await writeJson(join(packageRoot, "config", "workflow-model-tiers.json"), {
    tiers: { small: "small-model", big: "big-model" },
  });
  await writeJson(join(packageRoot, "config", "fabric.json"), {
    configVersion: 3,
    fullCodeMode: true,
    agents: {
      enabled: true,
      runner: "pi",
      transport: "herdr",
      extensions: true,
      defaultTools: ["read", "bash", "edit", "write", "grep", "find", "ls", "todo", "web_search"],
    },
    mesh: { enabled: true, actorScope: "project" },
    capture: { enabled: true, hideFromModel: true, keepVisible: ["fabric_exec"] },
  });
  await writeJson(join(packageRoot, "config", "workflow-settings.json"), { keywordTriggerEnabled: false });
  return {
    root,
    paths: {
      packageRoot,
      agentDir,
      ownerAgentDir: agentDir,
      workflowDir,
      lockPath: join(root, "home", ".pi", ".pi-haziq-setup.lock"),
    },
  };
}

test("setup separates custom agent directories while sharing one machine-wide owner lock", () => {
  const first = defaultSetupPaths("/package", "/home/tester", "/custom/pi-agent-a");
  const second = defaultSetupPaths("/package", "/home/tester", "/custom/pi-agent-b");
  assert.equal(first.agentDir, "/custom/pi-agent-a");
  assert.equal(first.ownerAgentDir, "/home/tester/.pi/agent");
  assert.equal(first.workflowDir, "/home/tester/.pi/workflows");
  assert.equal(first.lockPath, "/home/tester/.pi/.pi-haziq-setup.lock");
  assert.equal(second.lockPath, first.lockPath);
});

test("setup previews, backs up, applies, and becomes idempotent without changing model defaults", async () => {
  const { root, paths } = await fixture();
  try {
    await mkdir(paths.agentDir, { recursive: true });
    await writeFile(join(paths.agentDir, "APPEND_SYSTEM.md"), "# old local policy\n");
    await writeJson(join(paths.agentDir, "settings.json"), {
      defaultProvider: "meridian",
      defaultModel: "claude-opus-5",
      packages: ["git:github.com/haziqazizi/pi-haziq"],
      enabledModels: ["local/custom"],
      compaction: { keepRecentTokens: 20000 },
    });
    await writeJson(join(paths.agentDir, "extensions", "pi-better-compaction", "config.json"), {
      customLocalKey: "preserved",
      enabled: false,
    });
    await writeJson(join(paths.agentDir, "extensions", "pi-openai-service-tier.json"), {
      persistState: true,
      active: false,
    });

    const operations = await planSetup(paths);
    assert.equal(operations.length, 7);
    assert.equal(operations.filter((operation) => operation.status === "update").length, 4);
    assert.equal(operations.filter((operation) => operation.status === "create").length, 3);
    assert.match(formatSetupPlan(operations), /pi-haziq setup: 7 changes/);

    const applied = await applySetup(operations, new Date("2026-07-25T20:15:00.000Z"));
    assert.equal(applied.length, 7);
    assert.equal(applied.filter((operation) => operation.backup).length, 4);
    assert.equal((await lstat(join(paths.agentDir, "APPEND_SYSTEM.md"))).isSymbolicLink(), true);
    assert.equal(await readlink(join(paths.agentDir, "APPEND_SYSTEM.md")), join(paths.packageRoot, "APPEND_SYSTEM.md"));

    const settings = JSON.parse(await readFile(join(paths.agentDir, "settings.json"), "utf8"));
    assert.equal(settings.defaultProvider, "meridian");
    assert.equal(settings.defaultModel, "claude-opus-5");
    assert.deepEqual(settings.packages, ["git:github.com/haziqazizi/pi-haziq"]);
    assert.deepEqual(settings.enabledModels, [
      "local/custom",
      "meridian/claude-fable-5",
      "tokenmaxxing/gpt-5.6-sol",
    ]);
    assert.deepEqual(settings.compaction, {
      keepRecentTokens: 20000,
      enabled: true,
      reserveTokens: 16384,
    });

    const compaction = JSON.parse(
      await readFile(join(paths.agentDir, "extensions", "pi-better-compaction", "config.json"), "utf8"),
    );
    assert.equal(compaction.customLocalKey, "preserved");
    assert.equal(compaction.enabled, true);
    assert.equal(compaction.compactionModel, "tokenmaxxing/gpt-5.6-sol");

    const fabric = JSON.parse(await readFile(join(paths.agentDir, "fabric.json"), "utf8"));
    assert.equal(fabric.agents.enabled, true);
    assert.equal(fabric.agents.transport, "herdr");
    assert.equal(fabric.mesh.enabled, true);
    assert.ok(fabric.agents.defaultTools.includes("web_search"));
    assert.deepEqual(fabric.capture.keepVisible, ["fabric_exec"]);
    const workflowSettings = JSON.parse(await readFile(join(paths.workflowDir, "settings.json"), "utf8"));
    assert.equal(workflowSettings.keywordTriggerEnabled, false);

    const secondPlan = await planSetup(paths);
    assert.ok(secondPlan.every((operation) => operation.status === "unchanged"));
    assert.equal((await applySetup(secondPlan)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup fails before mutation when a packaged runtime policy is missing", async () => {
  const { root, paths } = await fixture();
  try {
    await rm(join(paths.packageRoot, "config", "fabric.json"));
    await assert.rejects(planSetup(paths), /Missing package setup source/);
    assert.equal(await readFile(join(paths.packageRoot, "APPEND_SYSTEM.md"), "utf8"), "# managed policy\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup fails before mutation when an owned JSON target is malformed", async () => {
  const { root, paths } = await fixture();
  try {
    await mkdir(paths.agentDir, { recursive: true });
    const settingsPath = join(paths.agentDir, "settings.json");
    await writeFile(settingsPath, "{not-json\n");
    await assert.rejects(planSetup(paths), /Cannot read JSON object/);
    assert.equal(await readFile(settingsPath, "utf8"), "{not-json\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup rolls back an updated file and symlink when a later install fails", async () => {
  const { root, paths } = await fixture();
  try {
    await mkdir(paths.agentDir, { recursive: true });
    const appendTarget = join(paths.agentDir, "APPEND_SYSTEM.md");
    const settingsTarget = join(paths.agentDir, "settings.json");
    await writeFile(appendTarget, "# old local policy\n");
    await writeJson(settingsTarget, { defaultModel: "keep-me" });
    const operations = await planSetup(paths);

    await assert.rejects(
      applySetup(operations, new Date("2026-07-25T20:16:00.000Z"), {
        beforeInstall(_operation, index) {
          if (index === 2) throw new Error("fault injection");
        },
      }),
      /fault injection/,
    );

    assert.equal((await lstat(appendTarget)).isSymbolicLink(), false);
    assert.equal(await readFile(appendTarget, "utf8"), "# old local policy\n");
    assert.deepEqual(JSON.parse(await readFile(settingsTarget, "utf8")), { defaultModel: "keep-me" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup aborts when a confirmed preview becomes stale", async () => {
  const { root, paths } = await fixture();
  try {
    await mkdir(paths.agentDir, { recursive: true });
    const settingsTarget = join(paths.agentDir, "settings.json");
    await writeJson(settingsTarget, { defaultModel: "first" });
    const operations = await planSetup(paths);
    await writeJson(settingsTarget, { defaultModel: "changed-after-preview" });
    await assert.rejects(applySetup(operations), /Setup target changed after preview/);
    assert.deepEqual(JSON.parse(await readFile(settingsTarget, "utf8")), { defaultModel: "changed-after-preview" });
    assert.equal((await lstat(join(paths.agentDir, "APPEND_SYSTEM.md")).catch(() => undefined)), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup revalidates rows previewed as unchanged", async () => {
  const { root, paths } = await fixture();
  try {
    const firstPlan = await planSetup(paths);
    await applySetup(firstPlan);
    const unchangedPlan = await planSetup(paths);
    assert.ok(unchangedPlan.every((operation) => operation.status === "unchanged"));

    const settingsTarget = join(paths.agentDir, "settings.json");
    await writeJson(settingsTarget, { changedAfterPreview: true });
    await assert.rejects(applySetup(unchangedPlan), /Setup target changed after preview/);
    assert.deepEqual(JSON.parse(await readFile(settingsTarget, "utf8")), { changedAfterPreview: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup refuses nested parent symlinks below an allowed root", async () => {
  const { root, paths } = await fixture();
  try {
    const outside = join(root, "outside");
    await Promise.all([mkdir(paths.ownerAgentDir, { recursive: true }), mkdir(outside, { recursive: true })]);
    await symlink(outside, join(paths.ownerAgentDir, "extensions"));
    await assert.rejects(planSetup(paths), /Refusing setup through nested parent symlink/);
    assert.deepEqual(await readFile(join(paths.packageRoot, "config", "pi-better-compaction.json"), "utf8").then(JSON.parse), {
      enabled: true,
      compactionModel: "tokenmaxxing/gpt-5.6-sol",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup rechecks nested parent symlinks introduced after preview", async () => {
  const { root, paths } = await fixture();
  try {
    const operations = await planSetup(paths);
    const outside = join(root, "outside-after-preview");
    await Promise.all([mkdir(paths.ownerAgentDir, { recursive: true }), mkdir(outside, { recursive: true })]);
    await symlink(outside, join(paths.ownerAgentDir, "extensions"));
    await assert.rejects(applySetup(operations), /Refusing setup through nested parent symlink/);
    assert.equal((await lstat(join(outside, "pi-better-compaction", "config.json")).catch(() => undefined)), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback preserves post-setup edits and leaves their backup for manual recovery", async () => {
  const { root, paths } = await fixture();
  try {
    await mkdir(paths.agentDir, { recursive: true });
    const appendTarget = join(paths.agentDir, "APPEND_SYSTEM.md");
    await writeFile(appendTarget, "# original\n");
    const operations = await planSetup(paths);
    await assert.rejects(
      applySetup(operations, new Date("2026-07-25T20:17:00.000Z"), {
        async beforeInstall(_operation, index) {
          if (index !== 2) return;
          await rm(appendTarget, { force: true });
          await writeFile(appendTarget, "# concurrent post-setup edit\n");
          throw new Error("later operation failed");
        },
      }),
      /rollback requires manual recovery/,
    );
    assert.equal(await readFile(appendTarget, "utf8"), "# concurrent post-setup edit\n");
    assert.equal(
      await readFile(`${appendTarget}.pre-pi-haziq-20260725T201700Z`, "utf8"),
      "# original\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup lock prevents concurrent setup writers", async () => {
  const { root, paths } = await fixture();
  try {
    const operations = await planSetup(paths);
    const lockPath = paths.lockPath;
    await mkdir(lockPath, { recursive: true });
    await assert.rejects(applySetup(operations, new Date(), { lockPath }), /Another pi-haziq setup is active/);
    assert.equal((await lstat(join(paths.agentDir, "APPEND_SYSTEM.md")).catch(() => undefined)), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
