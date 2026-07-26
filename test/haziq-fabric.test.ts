import assert from "node:assert/strict";
import test from "node:test";
import { parseFabricCapturedToolNames } from "../extensions/haziq-fabric.ts";

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
