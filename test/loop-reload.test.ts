import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("packages Monty pi-loop verification extension", () => {
  const pkg = require(join(root, "package.json"));
  assert.equal(pkg.dependencies["@monotykamary/pi-loop"], "0.1.17");
  assert.equal(pkg.dependencies["@koltmcbride/pi-loop"], undefined);
  assert.ok(pkg.pi.extensions.includes("./node_modules/@monotykamary/pi-loop/src/index.ts"));
  assert.equal(
    pkg.pi.extensions.includes("./extensions/haziq-loop.ts"),
    false,
    "Kolt loop wrapper must not remain registered",
  );
});
