import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let providerPayload;
let resolveProviderPayload;
const providerPayloadReady = new Promise((resolveReady) => { resolveProviderPayload = resolveReady; });
const providerServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    providerPayload = JSON.parse(body);
    resolveProviderPayload?.();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({
      id: "contract-probe",
      object: "chat.completion.chunk",
      created: 1,
      model: "probe",
      choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: "contract-probe",
      object: "chat.completion.chunk",
      created: 1,
      model: "probe",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolveListen, reject) => {
  providerServer.once("error", reject);
  providerServer.listen(0, "127.0.0.1", resolveListen);
});
const providerAddress = providerServer.address();
assert.ok(providerAddress && typeof providerAddress === "object");

const temp = await mkdtemp(join(tmpdir(), "pi-haziq-smoke."));
const home = join(temp, "home");
const cwd = join(temp, "cwd");
await Promise.all([mkdir(join(home, ".pi", "agent"), { recursive: true }), mkdir(join(home, ".pi", "workflows"), { recursive: true }), mkdir(cwd)]);
await writeFile(join(home, ".pi", "agent", "fabric.json"), JSON.stringify({ configVersion: 3, fullCodeMode: true, agents: { enabled: true, runner: "pi", transport: "herdr", extensions: true, defaultTools: ["read", "bash", "edit", "write", "grep", "find", "ls", "todo", "web_search", "agent_browser", "start_loop", "start_supervision", "source_check", "fetch_content", "get_search_content", "reason_harness_init", "reason_harness_solve", "reason_harness_status"] }, mesh: { enabled: true, actorScope: "project" }, capture: { enabled: true, hideFromModel: true, keepVisible: ["fabric_exec"] } }));
await writeFile(join(home, ".pi", "workflows", "settings.json"), JSON.stringify({ keywordTriggerEnabled: false }));
assert.equal(existsSync(join(root, "APPEND_SYSTEM.md")), true, "package must contain APPEND_SYSTEM.md");
await symlink(join(root, "APPEND_SYSTEM.md"), join(home, ".pi", "agent", "APPEND_SYSTEM.md"));
await writeFile(
  join(home, ".pi", "agent", "models.json"),
  JSON.stringify({
    providers: {
      "contract-probe": {
        baseUrl: `http://127.0.0.1:${providerAddress.port}/v1`,
        apiKey: "$CONTRACT_PROBE_API_KEY",
        api: "openai-completions",
        models: [{
          id: "probe",
          name: "Contract Probe",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32000,
          maxTokens: 1024,
        }],
      },
    },
  }),
);
const trustedMarker = join(temp, "TRUSTED_MCP_STARTED");
await writeFile(
  join(cwd, ".mcp.json"),
  JSON.stringify({
    mcpServers: {
      trustedSmoke: {
        command: "sh",
        args: ["-c", `touch ${trustedMarker}`],
        lifecycle: "eager",
      },
    },
  }),
);

const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith("HERDR_") || name.startsWith("PI_")) delete env[name];
}
env.HOME = home;
env.PI_OFFLINE = "1";
env.CONTRACT_PROBE_API_KEY = ["local", "test", "only"].join("-");

const pi = process.env.PI_HAZIQ_SMOKE_PI_BIN ?? join(root, "node_modules", ".bin", "pi");
const child = spawn(
  pi,
  [
    "--mode",
    "rpc",
    "--no-session",
    "--provider",
    "contract-probe",
    "--model",
    "probe",
    "--approve",
    "--offline",
    "--no-extensions",
    "-e",
    root,
    "--no-builtin-tools",
  ],
  { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
);

const events = [];
const waiters = new Set();
let stdoutBuffer = "";
let stderr = "";

function publish(value) {
  events.push(value);
  for (const waiter of [...waiters]) {
    if (waiter.predicate(value)) {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(value);
    }
  }
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  while (true) {
    const newline = stdoutBuffer.indexOf("\n");
    if (newline < 0) break;
    const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    try {
      publish(JSON.parse(line));
    } catch {
      publish({ type: "nonjson", line });
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

function waitFor(predicate, timeoutMs = 90_000) {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolveWait, reject) => {
    const waiter = {
      predicate,
      resolve: resolveWait,
      timer: setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`Timed out waiting for RPC event. Tail: ${JSON.stringify(events.slice(-15))}`));
      }, timeoutMs),
    };
    waiters.add(waiter);
  });
}

function send(command) {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}

try {
  send({ id: "commands", type: "get_commands" });
  const commands = await waitFor((event) => event.type === "response" && event.id === "commands");
  assert.equal(commands.success, true);
  const names = commands.data.commands.map((command) => command.name);
  assert.equal(names.filter((name) => name === "cohesion").length, 1, "cohesion command must load exactly once");
  assert.equal(names.includes("workflows"), false, "Dynamic workflow command must not be registered");
  assert.ok(names.includes("todos"));
  assert.ok(names.includes("mcp"));
  assert.ok(names.includes("fabric"));
  const fabricSkills = names.filter((name) => name.startsWith("skill:fabric-")).sort();
  assert.ok(fabricSkills.includes("skill:fabric-exec"), "fabric-exec must load (model-invoked)");
  assert.ok(fabricSkills.includes("skill:fabric-guide"), "fabric-guide router must load");
  assert.ok(fabricSkills.includes("skill:fabric-supervisor"));
  assert.ok(fabricSkills.length >= 12, "all Fabric skills should load, got " + fabricSkills.length);
  assert.ok(names.includes("skill:herdr-factory"), "herdr-factory skill must load");
  assert.ok(names.includes("skill:herdr-guide"), "herdr-guide skill must load");

  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  assert.equal(existsSync(trustedMarker), true, "trusted project MCP config did not initialize");

  send({ id: "doctor", type: "prompt", message: "/cohesion doctor" });
  const response = await waitFor((event) => event.type === "response" && event.id === "doctor");
  assert.equal(response.success, true);
  const notice = await waitFor(
    (event) => event.type === "extension_ui_request" && event.method === "notify" && event.message?.startsWith("Haziq cohesion:"),
  );
  assert.match(notice.message, /^Haziq cohesion: healthy/m);
  assert.match(notice.message, /^Tools: 3\/3 · Fabric-captured$/m);
  assert.match(notice.message, /^Runtime config: healthy$/m);
  assert.match(notice.message, /^Herdr session: not active$/m);
  assert.match(notice.message, /^Herdr dependency: /m);
  assert.match(notice.message, /APPEND_SYSTEM\.md$/m);

  send({ id: "fabric-captured", type: "prompt", message: "/fabric captured" });
  const fabricCapturedResponse = await waitFor(
    (event) => event.type === "response" && event.id === "fabric-captured",
  );
  assert.equal(fabricCapturedResponse.success, true);
  const capturedNotice = await waitFor(
    (event) =>
      event.type === "extension_ui_request" &&
      event.method === "notify" &&
      typeof event.message === "string" &&
      event.message.includes("start_loop"),
  );
  const capturedNames = new Set(
    capturedNotice.message.split("\n").map((line) => line.split(" ", 1)[0]),
  );
  for (const name of [
    "todo",
    "mcp",
    "start_loop",
  ]) {
    assert.equal(capturedNames.has(name), true, `${name} was not captured by Fabric`);
  }

  send({ id: "contract", type: "prompt", message: "/cohesion contract" });
  const contractResponse = await waitFor((event) => event.type === "response" && event.id === "contract");
  assert.equal(contractResponse.success, true);
  const contractNotice = await waitFor(
    (event) => event.type === "extension_ui_request" && event.method === "notify" && event.message?.startsWith("pi-haziq contract:"),
  );
  assert.match(contractNotice.message, /^pi-haziq contract: loaded/);

  send({ id: "setup-check", type: "prompt", message: "/cohesion setup check" });
  const setupResponse = await waitFor((event) => event.type === "response" && event.id === "setup-check");
  assert.equal(setupResponse.success, true);
  const setupNotice = await waitFor(
    (event) => event.type === "extension_ui_request" && event.method === "notify" && event.message?.startsWith("pi-haziq setup:"),
  );
  assert.match(setupNotice.message, /change/);
  assert.match(setupNotice.message, /keys:/);
  assert.equal(existsSync(join(home, ".pi", "agent", "settings.json")), false, "setup check must remain read-only");

  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "APPEND_SYSTEM.md"), "# trusted project append policy\n");
  send({ id: "reload", type: "prompt", message: "/cohesion reload" });
  const reload = await waitFor((event) => event.type === "response" && event.id === "reload");
  assert.equal(reload.success, true);

  send({ id: "commands-after-reload", type: "get_commands" });
  const afterReload = await waitFor(
    (event) => event.type === "response" && event.id === "commands-after-reload",
  );
  assert.equal(afterReload.success, true);
  const afterNames = afterReload.data.commands.map((command) => command.name);
  assert.equal(afterNames.filter((name) => name === "cohesion").length, 1, "reload must not duplicate cohesion");
  const afterFabricSkills = afterNames.filter((name) => name.startsWith("skill:fabric-")).sort();
  assert.ok(afterFabricSkills.includes("skill:fabric-guide"), "fabric-guide must survive reload");
  assert.ok(afterFabricSkills.length >= 12, "Fabric skills must survive reload");
  assert.equal(afterNames.includes("workflows"), false);

  send({ id: "contract-shadow", type: "prompt", message: "/cohesion contract" });
  const shadowResponse = await waitFor((event) => event.type === "response" && event.id === "contract-shadow");
  assert.equal(shadowResponse.success, true);
  const shadowNotice = await waitFor(
    (event) => event.type === "extension_ui_request" && event.method === "notify" && event.message?.startsWith("pi-haziq contract: extension fallback ready"),
  );
  assert.match(shadowNotice.message, /APPEND_SYSTEM\.md$/);

  send({ id: "provider-contract-probe", type: "prompt", message: "Reply with ok." });
  const providerResponse = await waitFor(
    (event) => event.type === "response" && event.id === "provider-contract-probe",
  );
  assert.equal(providerResponse.success, true);
  await Promise.race([
    providerPayloadReady,
    new Promise((_, reject) => setTimeout(() => reject(new Error("local provider did not receive a request payload")), 30_000)),
  ]);
  assert.ok(providerPayload, "local provider did not receive a request payload");
  const providerPrompt = JSON.stringify(providerPayload);
  assert.match(providerPrompt, /trusted project append policy/);
  assert.equal((providerPrompt.match(/PI_HAZIQ_CONTRACT_V1/g) ?? []).length, 2, "contract start/end sentinels must appear exactly once each");

  const extensionErrors = events.filter((event) => event.type === "extension_error");
  assert.deepEqual(extensionErrors, []);
  const stderrLines = stderr.trim().split("\n");
  assert.ok(stderrLines.length >= 1 && stderrLines.length <= 2, `unexpected stderr: ${stderr}`);
  assert.ok(
    stderrLines.every((line) => line === "MCP: Failed to connect to trustedSmoke: Connection closed"),
    `unexpected stderr: ${stderr}`,
  );

  console.log("package smoke: healthy, Fabric agents + full Fabric skills (guide router), 3/3 tools captured by Fabric, appended contract reached provider exactly once beside project policy, setup check read-only, trusted MCP initialized, reload-safe, no duplicates or extension errors");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
  await rm(temp, { recursive: true, force: true });
  await new Promise((resolveClose) => providerServer.close(resolveClose));
}
