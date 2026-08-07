import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFabricChildPath,
  pinFabricLaunchBinaries,
  resolveNodeBinary,
  resolvePiBinary,
} from "../src/fabric-binaries.ts";

function makeExec(root: string, name: string): string {
  const dir = join(root, "bin");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

test("resolvePiBinary prefers absolute PI_FABRIC_PI_BINARY override", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const piPath = makeExec(root, "pi");
  assert.equal(
    resolvePiBinary({ env: { PI_FABRIC_PI_BINARY: piPath, PATH: "" }, home: root, pathDirs: [], execPath: "/usr/bin/node" }),
    piPath,
  );
});

test("resolvePiBinary prefers pi-real-path JS entrypoint over wrapper", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const agent = join(root, ".pi", "agent");
  mkdirSync(join(agent, "bin"), { recursive: true });
  writeFileSync(join(agent, "bin", "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(join(agent, "bin", "pi"), 0o755);
  const cli = join(root, "cli.js");
  writeFileSync(cli, "export {}\n");
  writeFileSync(join(agent, "pi-real-path"), cli + "\n");
  assert.equal(
    resolvePiBinary({ env: { PATH: "" }, home: root, pathDirs: [], execPath: "/usr/bin/node" }),
    cli,
  );
});

test("resolveNodeBinary prefers current node execPath", () => {
  const root = mkdtempSync(join(tmpdir(), "node-bin-"));
  const nodePath = makeExec(root, "node");
  assert.equal(resolveNodeBinary({ env: { PATH: "" }, pathDirs: [], execPath: nodePath }), nodePath);
});

test("pinFabricLaunchBinaries sets absolute pi, real node, and child PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const piPath = makeExec(root, "pi");
  const nodePath = makeExec(root, "node");
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    PATH: join(root, "bin"),
    PI_FABRIC_NODE_BINARY: join(home, ".pi", "agent", "bin", "pi-fabric-node"),
  };
  const pinned = pinFabricLaunchBinaries({
    env,
    home,
    pathDirs: [join(root, "bin")],
    execPath: nodePath,
  });
  assert.equal(pinned.piBinary, piPath);
  assert.equal(pinned.nodeBinary, nodePath);
  assert.equal(env.PI_FABRIC_PI_BINARY, piPath);
  assert.equal(env.PI_FABRIC_NODE_BINARY, nodePath);
  assert.ok((env.PATH ?? "").includes(join(root, "bin")));
  assert.equal(env.PI_FABRIC_CHILD_PATH, pinned.path);
  assert.ok(buildFabricChildPath({ nodeBinary: nodePath, env: { PATH: "/usr/bin" }, home }).includes("/usr/bin"));
});

test("pinFabricLaunchBinaries keeps working absolute pi override", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const existing = makeExec(root, "custom-pi");
  makeExec(root, "pi");
  const env: NodeJS.ProcessEnv = { PI_FABRIC_PI_BINARY: existing, PATH: join(root, "bin") };
  const pinned = pinFabricLaunchBinaries({
    env,
    home: join(root, "empty-home"),
    pathDirs: [join(root, "bin")],
    execPath: "/usr/bin/node",
  });
  assert.equal(pinned.piBinary, existing);
  assert.equal(env.PI_FABRIC_PI_BINARY, existing);
});
