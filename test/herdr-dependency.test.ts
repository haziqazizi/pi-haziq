import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureHerdrIntegration,
  formatHerdrDependencyReport,
  inspectHerdrDependency,
  type HerdrExec,
} from "../src/herdr.ts";

function execMap(handlers: Record<string, { code?: number; stdout?: string; stderr?: string }>): HerdrExec {
  return async (file, args) => {
    const key = [file, ...args].join(" ");
    const hit = handlers[key] ?? handlers[file];
    if (!hit) throw new Error(`unexpected exec: ${key}`);
    return {
      code: hit.code ?? 0,
      stdout: hit.stdout ?? "",
      stderr: hit.stderr ?? "",
    };
  };
}

test("inspectHerdrDependency reports missing binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-haziq-herdr."));
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  const report = await inspectHerdrDependency({
    agentDir,
    exec: execMap({ which: { code: 1, stdout: "" }, where: { code: 1, stdout: "" } }),
    platform: "linux",
  });
  assert.equal(report.status, "missing-binary");
  assert.match(report.message, /[Oo]ptional/);
  assert.match(report.message, /herdr\.dev/);
});

test("inspectHerdrDependency reports missing integration when CLI exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-haziq-herdr."));
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  const report = await inspectHerdrDependency({
    agentDir,
    exec: execMap({ "which herdr": { stdout: "/usr/local/bin/herdr\n" } }),
    platform: "linux",
  });
  assert.equal(report.status, "missing-integration");
  assert.equal(report.binaryPath, "/usr/local/bin/herdr");
});

test("ensureHerdrIntegration installs via herdr integration install pi", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-haziq-herdr."));
  const agentDir = join(root, "agent");
  const extensions = join(agentDir, "extensions");
  await mkdir(extensions, { recursive: true });
  let installed = false;
  const exec: HerdrExec = async (file, args) => {
    const key = [file, ...args].join(" ");
    if (key === "which herdr") return { code: 0, stdout: "/usr/bin/herdr\n", stderr: "" };
    if (key === "/usr/bin/herdr integration install pi") {
      installed = true;
      await writeFile(join(extensions, "herdr-agent-state.ts"), "// installed by herdr\n");
      return { code: 0, stdout: "ok\n", stderr: "" };
    }
    throw new Error(`unexpected exec: ${key}`);
  };
  const result = await ensureHerdrIntegration({ agentDir, exec, platform: "linux" });
  assert.equal(installed, true);
  assert.equal(result.installedIntegration, true);
  assert.equal(result.report.status, "ready");
  assert.match(formatHerdrDependencyReport(result.report), /ready/);
});

test("ensureHerdrIntegration no-ops when already ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-haziq-herdr."));
  const agentDir = join(root, "agent");
  const extensions = join(agentDir, "extensions");
  await mkdir(extensions, { recursive: true });
  await writeFile(join(extensions, "herdr-agent-state.ts"), "// installed by herdr\n");
  let installCalls = 0;
  const exec: HerdrExec = async (file, args) => {
    const key = [file, ...args].join(" ");
    if (key === "which herdr") return { code: 0, stdout: "/usr/bin/herdr\n", stderr: "" };
    if (key === "/usr/bin/herdr integration install pi") {
      installCalls += 1;
      return { code: 0, stdout: "ok\n", stderr: "" };
    }
    throw new Error(`unexpected exec: ${key}`);
  };
  const result = await ensureHerdrIntegration({ agentDir, exec, platform: "linux" });
  assert.equal(installCalls, 0);
  assert.equal(result.installedIntegration, false);
  assert.equal(result.report.status, "ready");
});
