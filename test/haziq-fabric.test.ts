import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fabricStateRootFallback, parseFabricCapturedToolNames } from "../extensions/haziq-fabric.ts";

test("parses only structured Fabric captured-tool rows", () => {
  assert.deepEqual(
    parseFabricCapturedToolNames([
      "todo [execute] — /pkg/todo.ts",
      "workflow [execute] — /pkg/workflow.ts",
      "todo [execute] — /duplicate/todo.ts",
      "… 2 more captured tools",
    ].join("\n")),
    ["todo", "workflow"],
  );
  assert.deepEqual(parseFabricCapturedToolNames("No extension tools captured"), []);
});

test("fabricStateRootFallback leaves writable cwds and pinned env roots alone", () => {
  const writable = mkdtempSync(join(tmpdir(), "haziq-fabric-root-"));
  try {
    assert.equal(fabricStateRootFallback(writable, {}), undefined);
    assert.equal(
      fabricStateRootFallback("/", { PI_FABRIC_PROJECT_ROOT: writable }),
      undefined,
    );
    assert.equal(
      fabricStateRootFallback("/", { PI_FABRIC_MESH_ROOT: join(writable, "mesh") }),
      undefined,
    );
  } finally {
    rmSync(writable, { recursive: true, force: true });
  }
});

test("fabricStateRootFallback redirects unwritable cwds to the global agent root", (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root bypasses write-permission checks");
    return;
  }
  const locked = mkdtempSync(join(tmpdir(), "haziq-fabric-locked-"));
  try {
    chmodSync(locked, 0o555);
    assert.equal(
      fabricStateRootFallback(locked, {}, "/home/example"),
      join("/home/example", ".pi", "agent"),
    );
  } finally {
    chmodSync(locked, 0o755);
    rmSync(locked, { recursive: true, force: true });
  }
});
