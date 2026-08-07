import assert from "node:assert/strict";
import test from "node:test";
import { quietServiceTierStatusText } from "../src/service-tier-status.ts";

test("quiets unsupported service-tier footer text", () => {
  assert.equal(quietServiceTierStatusText(undefined), undefined);
  assert.equal(quietServiceTierStatusText(""), undefined);
  assert.equal(
    quietServiceTierStatusText("tier requested; unsupported xai/grok-4.5"),
    undefined,
  );
  assert.equal(
    quietServiceTierStatusText("gpt-5.5 priority unsupported"),
    undefined,
  );
  assert.equal(quietServiceTierStatusText("gpt-5.5 priority"), "gpt-5.5 priority");
  assert.equal(
    quietServiceTierStatusText("\u001b[36mgpt-5.5 priority\u001b[39m"),
    "\u001b[36mgpt-5.5 priority\u001b[39m",
  );
});
