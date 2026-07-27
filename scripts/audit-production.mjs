import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const honoEntry = require.resolve("@hono/node-server");
const honoPackage = JSON.parse(readFileSync(join(dirname(dirname(honoEntry)), "package.json"), "utf8"));

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const audit = spawnSync(npmCommand, ["audit", "--omit=dev", "--json"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (!audit.stdout.trim()) {
  process.stderr.write(audit.stderr);
  throw new Error(`npm audit produced no JSON (exit ${audit.status})`);
}

const report = JSON.parse(audit.stdout);
const vulnerabilities = report.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities);
if (names.length === 0) {
  console.log("production audit: no vulnerabilities reported");
  process.exit(0);
}

const expectedNames = ["@hono/node-server", "@modelcontextprotocol/sdk"];
const honoVia = vulnerabilities["@hono/node-server"]?.via;
const sdkVia = vulnerabilities["@modelcontextprotocol/sdk"]?.via;
const exactExpectedChain =
  honoPackage.version === "1.19.15" &&
  names.length === expectedNames.length &&
  expectedNames.every((name) => names.includes(name)) &&
  Array.isArray(honoVia) &&
  honoVia.length === 1 &&
  typeof honoVia[0] === "object" &&
  honoVia[0].url === "https://github.com/advisories/GHSA-frvp-7c67-39w9" &&
  Array.isArray(sdkVia) &&
  sdkVia.length === 1 &&
  sdkVia[0] === "@hono/node-server";

if (!exactExpectedChain) {
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  throw new Error("production audit contains an unverified vulnerability");
}

console.log(
  "production audit: only GHSA-frvp-7c67-39w9 stale metadata remains through the MCP SDK; installed @hono/node-server@1.19.15 is the patched 1.x release",
);
