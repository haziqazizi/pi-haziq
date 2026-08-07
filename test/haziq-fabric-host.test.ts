import assert from "node:assert/strict";
import test from "node:test";
import { shouldHostPiFabric } from "../extensions/haziq-fabric.ts";

test("hosts Fabric in normal main sessions", () => {
  assert.equal(shouldHostPiFabric({}, []), true);
  assert.equal(shouldHostPiFabric({ PI_FABRIC_DEPTH: "0" }, []), true);
});

test("does not host Fabric in actor workers", () => {
  assert.equal(shouldHostPiFabric({ PI_FABRIC_ACTOR_ID: "abc" }, []), false);
  assert.equal(
    shouldHostPiFabric({ PI_FABRIC_ACTOR_ID: "abc", PI_FABRIC_DEPTH: "1" }, ["fabric_exec"]),
    false,
  );
});

test("does not host Fabric when fabric_exec is already registered", () => {
  assert.equal(shouldHostPiFabric({}, ["fabric_exec", "todo"]), false);
});
