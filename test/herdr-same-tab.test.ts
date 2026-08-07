import assert from "node:assert/strict";
import test from "node:test";
import {
  argvToExecCommand,
  chooseSplitDirection,
  extractPaneId,
  extractTabId,
  parseHerdrJson,
} from "../src/herdr-same-tab.ts";

test("chooseSplitDirection prefers right for wide panes and down for tall panes", () => {
  assert.equal(chooseSplitDirection({ width: 120, height: 40 }), "right");
  assert.equal(chooseSplitDirection({ width: 40, height: 80 }), "down");
  assert.equal(chooseSplitDirection({ cols: 100, rows: 100 }), "right");
  assert.equal(chooseSplitDirection(null), "right");
});

test("argvToExecCommand shell-quotes argv for pane run", () => {
  assert.equal(
    argvToExecCommand(["/usr/bin/node", "/tmp/worker.js", "--name", "a b"]),
    "exec '/usr/bin/node' '/tmp/worker.js' '--name' 'a b'",
  );
});

test("parseHerdrJson and pane field extractors", () => {
  const payload = { result: { pane: { pane_id: "w1:p2", tab_id: "w1:t1", terminal_id: "term_1" } } };
  assert.deepEqual(parseHerdrJson(JSON.stringify(payload)), payload);
  assert.equal(extractPaneId(payload), "w1:p2");
  assert.equal(extractTabId(payload), "w1:t1");
});
