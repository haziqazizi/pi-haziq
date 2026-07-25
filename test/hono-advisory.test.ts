import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { serveStatic } from "@hono/node-server/serve-static";

const require = createRequire(import.meta.url);
const honoEntry = require.resolve("@hono/node-server");
const honoPackage = JSON.parse(readFileSync(join(dirname(dirname(honoEntry)), "package.json"), "utf8")) as {
  version: string;
};

test("pins the patched Hono 1.x release and rejects encoded backslashes", async () => {
  assert.equal(honoPackage.version, "1.19.15");

  const requestPath = "/..%5Csecret.txt";
  let notFoundPath: string | undefined;
  let nextCalls = 0;
  const middleware = serveStatic({
    root: ".",
    onNotFound(path) {
      notFoundPath = path;
    },
  });

  await middleware(
    {
      finalized: false,
      req: { path: requestPath },
    } as never,
    async () => {
      nextCalls += 1;
    },
  );

  assert.equal(notFoundPath, requestPath, "the traversal guard must reject before filesystem path construction");
  assert.equal(nextCalls, 1);
});
