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

test("package advertises one workflow skill and Fabric core only", () => {
  assert.deepEqual(pkg.pi.skills, [
    "./node_modules/@haziqazizi/designing-dynamic-workflows",
    "./node_modules/pi-fabric/skills/fabric-exec",
  ]);
  assert.equal(
    pkg.pi.skills.some((path) => path.includes("pi-dynamic-workflows/skills/")),
    false,
  );
  assert.ok(pkg.pi.extensions.includes("./node_modules/@quintinshaw/pi-dynamic-workflows/extensions/workflow.ts"));
  assert.ok(pkg.pi.extensions.includes("./extensions/haziq-fabric.ts"));
  assert.equal(pkg.pi.extensions.includes("./node_modules/pi-fabric/dist/index.js"), false);
  assert.equal(pkg.dependencies["pi-fabric"], "0.28.1");
  assert.equal(pkg.engines.node, ">=24");
  assert.ok(pkg.bundledDependencies.includes("@haziqazizi/designing-dynamic-workflows"));
  assert.ok(pkg.bundledDependencies.includes("pi-fabric"));
});

test("reviews Fabric's isolated worker core dependency", () => {
  const fabric = JSON.parse(
    readFileSync(join(root, "node_modules/pi-fabric/package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  const coreDependencies = Object.keys(fabric.dependencies)
    .filter((name) => name.startsWith("@earendil-works/"))
    .sort();
  // Fabric's standalone worker imports pi-ai in a separate process; upstream
  // package tests require it at runtime instead of resolving the host peer.
  assert.deepEqual(coreDependencies, ["@earendil-works/pi-ai"]);
  assert.equal(fabric.dependencies["@earendil-works/pi-ai"], "0.80.6");
});

test("hidden runtime contracts remain installed for the visible skill adapter", () => {
  for (const path of [
    "node_modules/@haziqazizi/designing-dynamic-workflows/SKILL.md",
    "node_modules/@haziqazizi/designing-dynamic-workflows/reference/pi-dynamic-workflows.md",
    "node_modules/@quintinshaw/pi-dynamic-workflows/skills/workflow-authoring/SKILL.md",
    "node_modules/@quintinshaw/pi-dynamic-workflows/skills/workflow-patterns/SKILL.md",
    "node_modules/pi-fabric/skills/fabric-exec/SKILL.md",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `missing bundled contract: ${path}`);
  }
});
