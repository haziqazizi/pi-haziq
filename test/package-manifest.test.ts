import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  pi: { extensions: string[]; skills: string[] };
  dependencies: Record<string, string>;
  bundledDependencies: string[];
  engines: { node: string };
};

const dynamicExtension = "./node_modules/@quintinshaw/pi-dynamic-workflows/extensions/workflow.ts";

test("package exposes Dynamic doctrine, Fabric authoring, and pi-subagents skills", () => {
  assert.deepEqual(pkg.pi.skills, [
    "./node_modules/@haziqazizi/designing-dynamic-workflows",
    "./node_modules/pi-fabric/skills/fabric-exec",
    "./node_modules/pi-subagents/skills",
  ]);
  assert.equal(pkg.pi.skills.some((path) => path.includes("pi-dynamic-workflows/skills/")), false);
  assert.equal(pkg.pi.skills.some((path) => /pi-fabric\/skills\/(?!fabric-exec)/.test(path)), false);
  assert.ok(pkg.pi.extensions.includes(dynamicExtension));
  assert.ok(pkg.pi.extensions.includes("./node_modules/pi-subagents/index.ts"));
  assert.ok(pkg.pi.extensions.includes("./extensions/haziq-fabric.ts"));
  assert.equal(pkg.pi.extensions.includes("./node_modules/pi-fabric/dist/index.js"), false);
  assert.equal(
    pkg.dependencies["@haziqazizi/designing-dynamic-workflows"],
    "https://github.com/haziqazizi/designing-dynamic-workflows/archive/c0320dffdcd2ded349220f92ab23e12c390c6f50.tar.gz",
  );
  assert.equal(pkg.dependencies["pi-fabric"], "0.28.6");
  assert.equal(pkg.dependencies["pi-subagents"], "0.40.0");
  assert.equal(pkg.dependencies["@quintinshaw/pi-dynamic-workflows"], "https://github.com/haziqazizi/pi-dynamic-workflows/archive/d76cdb5da3cb0ad87cfabdc1aa39212047148b45.tar.gz");
  assert.equal(pkg.engines.node, ">=24");
  assert.ok(pkg.bundledDependencies.includes("@haziqazizi/designing-dynamic-workflows"));
  assert.ok(pkg.bundledDependencies.includes("@quintinshaw/pi-dynamic-workflows"));
  assert.ok(pkg.bundledDependencies.includes("pi-fabric"));
  assert.ok(pkg.bundledDependencies.includes("pi-subagents"));
});

test("packages parent model inheritance with asynchronous execution as the default", () => {
  const runtimeRoot = join(root, "node_modules/@quintinshaw/pi-dynamic-workflows");
  const extension = readFileSync(join(runtimeRoot, "extensions/workflow.ts"), "utf8");
  const agent = readFileSync(join(runtimeRoot, "src/agent.ts"), "utf8");
  const tool = readFileSync(join(runtimeRoot, "src/workflow-tool.ts"), "utf8");

  assert.ok(extension.includes("pi.getThinkingLevel()"));
  assert.ok(agent.includes("if (mainModel) return mainModel"));
  assert.ok(tool.includes("params.background ?? true"));
});

test("uses reviewed upstream Fabric with its isolated worker dependency", () => {
  const fabric = JSON.parse(readFileSync(join(root, "node_modules/pi-fabric/package.json"), "utf8")) as {
    version: string;
    repository?: { url?: string };
    dependencies: Record<string, string>;
  };
  assert.equal(fabric.version, "0.28.6");
  assert.match(fabric.repository?.url ?? "", /monotykamary\/pi-fabric/);
  const coreDependencies = Object.keys(fabric.dependencies)
    .filter((name) => name.startsWith("@earendil-works/"))
    .sort();
  assert.deepEqual(coreDependencies, ["@earendil-works/pi-ai"]);
  assert.equal(fabric.dependencies["@earendil-works/pi-ai"], "0.82.1");
});

test("hidden runtime contracts remain installed for the visible adapter", () => {
  for (const path of [
    "node_modules/@haziqazizi/designing-dynamic-workflows/SKILL.md",
    "node_modules/@haziqazizi/designing-dynamic-workflows/reference/pi-dynamic-workflows.md",
    "node_modules/@quintinshaw/pi-dynamic-workflows/skills/workflow-authoring/SKILL.md",
    "node_modules/@quintinshaw/pi-dynamic-workflows/skills/workflow-patterns/SKILL.md",
    "node_modules/pi-fabric/skills/fabric-exec/SKILL.md",
    "node_modules/pi-subagents/skills/pi-subagents/SKILL.md",
    "node_modules/pi-subagents/index.ts",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `missing bundled contract: ${path}`);
  }
});
