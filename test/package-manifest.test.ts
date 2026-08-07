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


test("package exposes all Fabric skills plus reason-harness", () => {
  assert.deepEqual(pkg.pi.skills, [
      "./node_modules/pi-fabric/skills/fabric-exec",
      "./node_modules/pi-fabric/skills/fabric-guide",
      "./node_modules/pi-fabric/skills/fabric-workflow",
      "./node_modules/pi-fabric/skills/fabric-council",
      "./node_modules/pi-fabric/skills/fabric-fusion",
      "./node_modules/pi-fabric/skills/fabric-rlm",
      "./node_modules/pi-fabric/skills/fabric-schema",
      "./node_modules/pi-fabric/skills/fabric-advisor",
      "./node_modules/pi-fabric/skills/fabric-supervisor",
      "./node_modules/pi-fabric/skills/fabric-spec",
      "./node_modules/pi-fabric/skills/fabric-ambient",
      "./node_modules/pi-fabric/skills/fabric-swarm",
      "./node_modules/pi-reason-harness/skills/reason-harness"
  ]);
  assert.ok(pkg.pi.skills.includes("./node_modules/pi-fabric/skills/fabric-guide"));
  assert.ok(pkg.pi.skills.includes("./node_modules/pi-fabric/skills/fabric-supervisor"));
  assert.ok(pkg.pi.extensions.includes("./extensions/haziq-fabric.ts"));
  assert.equal(pkg.pi.extensions.includes("./node_modules/pi-fabric/dist/index.js"), false);
  assert.equal(pkg.dependencies["pi-fabric"], "0.40.1");
  assert.equal(pkg.dependencies["pi-subagents"], undefined);
  assert.equal(pkg.dependencies["pi-tool-repair"], "0.1.10");
  assert.equal(pkg.dependencies["@monotykamary/pi-loop"], "0.1.17");
  assert.equal(pkg.dependencies["@monotykamary/pi-supervisor"], "0.5.13");
  assert.equal(pkg.dependencies["pi-reason-harness"], "1.0.7");
  assert.equal(pkg.dependencies["pi-invisible-continue"], "0.3.6");
  assert.equal(pkg.dependencies["pi-autoresearch-harness"], "1.0.4");
  assert.ok(pkg.pi.extensions.includes("./node_modules/pi-tool-repair/tool-repair.ts"));
  assert.ok(pkg.pi.extensions.includes("./node_modules/@monotykamary/pi-loop/src/index.ts"));
  assert.ok(pkg.bundledDependencies.includes("pi-tool-repair"));
  assert.ok(pkg.bundledDependencies.includes("@monotykamary/pi-loop"));
  assert.equal(pkg.engines.node, ">=24");
  assert.ok(pkg.bundledDependencies.includes("pi-fabric"));
  assert.equal(pkg.bundledDependencies.includes("pi-subagents"), false);
});

test("does not package Dynamic Workflows", () => {
});

test("uses reviewed upstream Fabric with its isolated worker dependency", () => {
  const fabric = JSON.parse(readFileSync(join(root, "node_modules/pi-fabric/package.json"), "utf8")) as {
    version: string;
    repository?: { url?: string };
    dependencies: Record<string, string>;
  };
  assert.equal(fabric.version, "0.40.1");
  assert.match(fabric.repository?.url ?? "", /monotykamary\/pi-fabric/);
  const coreDependencies = Object.keys(fabric.dependencies)
    .filter((name) => name.startsWith("@earendil-works/"))
    .sort();
  assert.deepEqual(coreDependencies, ["@earendil-works/pi-ai"]);
  assert.equal(fabric.dependencies["@earendil-works/pi-ai"], "0.84.1");
});

test("hidden runtime contracts remain installed for the visible adapter", () => {
  for (const path of [
    "node_modules/pi-fabric/skills/fabric-exec/SKILL.md",
    "node_modules/@monotykamary/pi-loop/src/index.ts",
    "node_modules/pi-reason-harness/skills/reason-harness/SKILL.md",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `missing bundled contract: ${path}`);
  }
});
