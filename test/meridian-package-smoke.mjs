import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "pi-haziq-meridian-smoke."));
const home = join(temp, "home");
const cwd = join(temp, "cwd");
await Promise.all([mkdir(join(home, ".pi", "agent"), { recursive: true }), mkdir(cwd)]);
let catalogRequests = 0;
const server = createServer((request, response) => {
  if (request.url !== "/v1/models") {
    response.writeHead(404).end();
    return;
  }
  catalogRequests += 1;
  assert.equal(request.headers["x-api-key"], "test-meridian-key");
  assert.equal(request.headers["x-test-access"], "test-access-value");
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      data: [
        { id: "claude-opus-5", context_window: 1_000_000, max_output_tokens: 128_000 },
        { id: "claude-new-5", context_window: 500_000, max_output_tokens: 64_000, reasoning: true },
      ],
    }),
  );
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
await writeFile(
  join(home, ".pi", "agent", "settings.json"),
  JSON.stringify({ defaultProvider: "meridian", defaultModel: "claude-opus-5" }),
);
await writeFile(
  join(home, ".pi", "agent", "models.json"),
  JSON.stringify({
    providers: {
      meridian: {
        baseUrl: `http://127.0.0.1:${address.port}`,
        api: "anthropic-messages",
        apiKey: "test-meridian-key",
        headers: { "x-test-access": "test-access-value" },
        models: [
          {
            id: "claude-opus-5",
            name: "Claude Opus 5 via Meridian",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200_000,
            maxTokens: 128_000,
          },
        ],
      },
    },
  }),
);
const env = { ...process.env, HOME: home };
for (const name of Object.keys(env)) {
  if (name.startsWith("HERDR_") || name.startsWith("PI_")) delete env[name];
}
const pi = process.env.PI_HAZIQ_SMOKE_PI_BIN ?? join(root, "node_modules", ".bin", "pi");
const child = spawn(
  pi,
  ["--mode", "rpc", "--no-session", "--no-context-files", "--no-builtin-tools", "--no-extensions", "-e", root],
  { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
);
let buffer = "";
let stderr = "";
const events = [];
const waiters = new Set();
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const event = JSON.parse(line);
    events.push(event);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(event);
    }
  }
});
child.stderr.on("data", (chunk) => { stderr += chunk; });
function waitFor(predicate, timeoutMs = 90_000) {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolveWait, reject) => {
    const waiter = {
      predicate,
      resolve: resolveWait,
      timer: setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`RPC timeout; stderr=${stderr}`));
      }, timeoutMs),
    };
    waiters.add(waiter);
  });
}
try {
  child.stdin.write(`${JSON.stringify({ id: "models", type: "get_available_models" })}\n`);
  const response = await waitFor((event) => event.type === "response" && event.id === "models");
  assert.equal(response.success, true);
  const models = response.data.models.filter((model) => model.provider === "meridian");
  const opus = models.find((model) => model.id === "claude-opus-5");
  const added = models.find((model) => model.id === "claude-new-5");
  assert.equal(opus?.contextWindow, 1_000_000);
  assert.equal(opus?.maxTokens, 128_000);
  assert.equal(added?.contextWindow, 500_000);
  assert.equal(added?.maxTokens, 64_000);
  child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
  const state = await waitFor((event) => event.type === "response" && event.id === "state");
  assert.equal(state.data.model?.provider, "meridian");
  assert.equal(state.data.model?.id, "claude-opus-5");
  assert.equal(state.data.model?.contextWindow, 1_000_000);
  assert.equal(catalogRequests, 1);
  assert.equal(stderr.trim(), "");
  console.log("Meridian package smoke: authenticated refresh published capability metadata without persisting credentials");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolveExit(); }, 10_000);
    child.once("exit", () => { clearTimeout(timer); resolveExit(); });
  });
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}
