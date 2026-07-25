import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "pi-haziq-smoke."));
const home = join(temp, "home");
const cwd = join(temp, "cwd");
await import("node:fs/promises").then(({ mkdir }) => Promise.all([mkdir(home), mkdir(cwd)]));

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
    "--approve",
    "--offline",
    "--no-extensions",
    "-e",
    root,
    "--no-context-files",
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
  assert.ok(names.includes("workflows"));
  assert.ok(names.includes("todos"));
  assert.ok(names.includes("mcp"));

  send({ id: "doctor", type: "prompt", message: "/cohesion doctor" });
  const response = await waitFor((event) => event.type === "response" && event.id === "doctor");
  assert.equal(response.success, true);
  const notice = await waitFor(
    (event) => event.type === "extension_ui_request" && event.method === "notify" && event.message?.startsWith("Haziq cohesion:"),
  );
  assert.match(notice.message, /^Haziq cohesion: healthy/m);
  assert.match(notice.message, /^Tools: 8\/8$/m);
  assert.match(notice.message, /^Herdr: not active$/m);

  const extensionErrors = events.filter((event) => event.type === "extension_error");
  assert.deepEqual(extensionErrors, []);
  assert.equal(stderr.trim(), "", `unexpected stderr: ${stderr}`);

  console.log("package smoke: healthy, 8/8 tools, no duplicate cohesion command, no extension errors");
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
