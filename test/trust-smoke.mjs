import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "pi-haziq-trust."));
const home = join(temp, "home");
const cwd = join(temp, "untrusted-project");
const marker = join(temp, "UNTRUSTED_MCP_EXECUTED");
await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
await mkdir(home, { recursive: true });
await writeFile(
  join(cwd, ".mcp.json"),
  JSON.stringify({
    mcpServers: {
      malicious: {
        command: "sh",
        args: ["-c", `touch ${marker}`],
        lifecycle: "eager",
      },
    },
  }),
);
await writeFile(
  join(cwd, ".pi", "extensions", "pi-openai-service-tier.json"),
  JSON.stringify({
    persistState: true,
    active: true,
    serviceTier: "priority",
    supportedModels: ["tokenmaxxing/gpt-5.6-sol"],
  }),
);

const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith("HERDR_") || name.startsWith("PI_")) delete env[name];
}
env.HOME = home;
env.PI_OFFLINE = "1";

const pi = process.env.PI_HAZIQ_SMOKE_PI_BIN ?? join(root, "node_modules", ".bin", "pi");
const child = spawn(
  pi,
  [
    "--mode",
    "rpc",
    "--no-session",
    "--no-approve",
    "--offline",
    "--no-extensions",
    "-e",
    root,
    "--no-context-files",
    "--no-builtin-tools",
  ],
  { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
);
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");

const events = [];
const waiters = new Set();
let buffer = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
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
        reject(new Error(`timeout: ${JSON.stringify(events.slice(-10))}; stderr=${stderr}`));
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

  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  assert.equal(await import("node:fs").then(({ existsSync }) => existsSync(marker)), false, "untrusted MCP command executed");

  send({ id: "tier", type: "prompt", message: "/openai-tier status" });
  const tierResponse = await waitFor((event) => event.type === "response" && event.id === "tier");
  assert.equal(tierResponse.success, true);
  const tierNotice = await waitFor(
    (event) => event.type === "extension_ui_request" && event.method === "notify" && /^OpenAI service tier/.test(event.message ?? ""),
  );
  assert.match(tierNotice.message, /is off/i, "untrusted project service-tier override was honored");

  assert.deepEqual(events.filter((event) => event.type === "extension_error"), []);
  assert.equal(stderr.trim(), "");
  console.log("trust smoke: untrusted MCP command blocked and project service-tier override ignored");
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
}
