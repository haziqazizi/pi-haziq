import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinFabricLaunchBinaries, resolveNodeBinary, resolvePiBinary } from "../src/fabric-binaries.ts";

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
    resolvePiBinary({
      env: { PI_FABRIC_PI_BINARY: piPath, PATH: "" },
      home: root,
      pathDirs: [],
      execPath: "/usr/bin/node",
    }),
    piPath,
  );
});

test("resolvePiBinary prefers pi-real-path JS entrypoint over wrapper", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const agent = join(root, ".pi", "agent");
  mkdirSync(join(agent, "bin"), { recursive: true });
  const wrapper = join(agent, "bin", "pi");
  writeFileSync(wrapper, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(wrapper, 0o755);
  const cli = join(root, "cli.js");
  writeFileSync(cli, "export {}\n", { mode: 0o644 });
  writeFileSync(join(agent, "pi-real-path"), `${cli}\n`);
  assert.equal(
    resolvePiBinary({
      env: { PATH: "" },
      home: root,
      pathDirs: [],
      execPath: "/usr/bin/node",
    }),
    cli,
  );
});

test("resolvePiBinary finds ~/.pi/agent/bin/pi without PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const agentBin = join(root, ".pi", "agent", "bin");
  mkdirSync(agentBin, { recursive: true });
  const piPath = join(agentBin, "pi");
  writeFileSync(piPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(piPath, 0o755);
  assert.equal(
    resolvePiBinary({
      env: { PATH: "/usr/bin" },
      home: root,
      pathDirs: ["/usr/bin"],
      execPath: "/usr/bin/node",
    }),
    piPath,
  );
});

test("resolvePiBinary resolves bare override via PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const piPath = makeExec(root, "pi");
  assert.equal(
    resolvePiBinary({
      env: { PI_FABRIC_PI_BINARY: "pi", PATH: join(root, "bin") },
      home: join(root, "empty-home"),
      pathDirs: [join(root, "bin")],
      execPath: "/usr/bin/node",
    }),
    piPath,
  );
});

test("resolvePiBinary falls back to PATH lookup", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const piPath = makeExec(root, "pi");
  assert.equal(
    resolvePiBinary({
      env: { PATH: join(root, "bin") },
      home: join(root, "empty-home"),
      pathDirs: [join(root, "bin")],
      execPath: "/usr/bin/node",
    }),
    piPath,
  );
});

test("resolvePiBinary returns bare pi when nothing is found", () => {
  assert.equal(
    resolvePiBinary({
      env: { PATH: "" },
      home: join(mkdtempSync(join(tmpdir(), "pi-bin-")), "nope"),
      pathDirs: [],
      execPath: "/usr/bin/node",
    }),
    "pi",
  );
});

test("resolveNodeBinary prefers current node execPath", () => {
  const root = mkdtempSync(join(tmpdir(), "node-bin-"));
  const nodePath = makeExec(root, "node");
  assert.equal(
    resolveNodeBinary({
      env: { PATH: "" },
      pathDirs: [],
      execPath: nodePath,
    }),
    nodePath,
  );
});

test("pinFabricLaunchBinaries writes absolute env overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const piPath = makeExec(root, "pi");
  const nodePath = makeExec(root, "node");
  const env: NodeJS.ProcessEnv = { PATH: join(root, "bin") };
  const pinned = pinFabricLaunchBinaries({
    env,
    home: join(root, "empty-home"),
    pathDirs: [join(root, "bin")],
    execPath: nodePath,
  });
  assert.equal(pinned.piBinary, piPath);
  assert.equal(pinned.nodeBinary, nodePath);
  assert.equal(env.PI_FABRIC_PI_BINARY, piPath);
  assert.equal(env.PI_FABRIC_NODE_BINARY, nodePath);
});

test("pinFabricLaunchBinaries does not replace a working absolute override", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bin-"));
  const existing = makeExec(root, "custom-pi");
  const other = makeExec(root, "pi");
  const env: NodeJS.ProcessEnv = {
    PI_FABRIC_PI_BINARY: existing,
    PATH: join(root, "bin"),
  };
  const pinned = pinFabricLaunchBinaries({
    env,
    home: join(root, "empty-home"),
    pathDirs: [join(root, "bin")],
    execPath: "/usr/bin/node",
  });
  assert.equal(pinned.piBinary, existing);
  assert.equal(env.PI_FABRIC_PI_BINARY, existing);
  assert.notEqual(pinned.piBinary, other);
});
