#!/usr/bin/env node
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";
import { randomUUID } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { pinFabricLaunchBinaries, resolvePiBinary } = await import(
  pathToFileURL(join(root, "src/fabric-binaries.ts")).href
);

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ ok: false, code: null, error: error.message, stdout, stderr });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, error: null, stdout, stderr });
    });
  });
}

function herdrRequest(socketPath, request) {
  const endpoint =
    process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  const payload = JSON.stringify({ id: `probe:${randomUUID()}`, ...request });
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const chunks = [];
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("herdr request timeout")), 5000);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${payload}\n`));
    socket.on("data", (chunk) => {
      const nl = chunk.indexOf("\n");
      chunks.push(nl < 0 ? chunk : chunk.slice(0, nl));
      if (nl < 0) return;
      try {
        finish(null, JSON.parse(chunks.join("")));
      } catch (error) {
        finish(error);
      }
    });
    socket.on("error", (error) => finish(error));
  });
}

const failures = [];
// Keep a real node/bun runtime on PATH (pi wrappers are #!/usr/bin/env node),
// but omit ~/.pi/agent/bin and ~/.local/bin so bare `pi` is missing.
const runtimeDir = dirname(process.execPath);
const strippedPath = [runtimeDir, "/usr/bin", "/bin"].join(":");
const strippedEnv = { ...process.env, PATH: strippedPath };
delete strippedEnv.PI_FABRIC_PI_BINARY;

const bare = await run("pi", ["--version"], strippedEnv);
if (bare.ok) {
  // If /usr/bin/pi exists, skip the negative assertion.
  console.log("note: bare pi available even with stripped PATH; skipping negative PATH case");
} else if (!/ENOENT|not found|No such file/i.test(bare.error || bare.stderr || "")) {
  failures.push(`expected bare pi ENOENT, got ${JSON.stringify(bare)}`);
} else {
  console.log("ok: bare pi fails with stripped PATH:", bare.error || bare.stderr.trim());
}

const pinned = pinFabricLaunchBinaries({ env: { ...process.env } });
if (!pinned.piBinary.startsWith("/")) {
  failures.push(`pi binary not absolute: ${pinned.piBinary}`);
}
accessSync(pinned.piBinary, constants.X_OK);
const abs = await run(pinned.piBinary, ["--version"], strippedEnv);
if (!abs.ok) {
  failures.push(`absolute pi --version failed: ${JSON.stringify(abs)}`);
} else {
  console.log("ok: absolute pi --version =>", abs.stdout.trim() || abs.stderr.trim());
}

// Worker-style: spawn pi with only PI_FABRIC_PI_BINARY set and minimal PATH
const workerLike = await run(pinned.piBinary, ["--help"], {
  PATH: strippedPath,
  HOME: process.env.HOME,
  PI_FABRIC_PI_BINARY: pinned.piBinary,
});
if (!workerLike.ok) {
  failures.push(`worker-like absolute launch failed: ${JSON.stringify(workerLike)}`);
} else {
  console.log("ok: worker-like absolute launch");
}

// Simulate Fabric worker child spawn (cross-spawn style bare name vs absolute).
{
  const bareWorker = await run("pi", ["--version"], strippedEnv);
  if (bareWorker.ok) {
    console.log("note: bare worker spawn unexpectedly ok under stripped PATH");
  } else if (!/ENOENT|not found/i.test(bareWorker.error || "")) {
    failures.push(`bare worker spawn unexpected error: ${JSON.stringify(bareWorker)}`);
  } else {
    console.log("ok: worker-style bare spawn pi ENOENT under stripped PATH");
  }
  const absWorker = await run(pinned.piBinary, ["--version"], {
    ...strippedEnv,
    PI_FABRIC_PI_BINARY: pinned.piBinary,
  });
  if (!absWorker.ok) {
    failures.push(`worker-style absolute spawn failed: ${JSON.stringify(absWorker)}`);
  } else {
    console.log("ok: worker-style absolute spawn pi under stripped PATH");
  }
}

if (process.env.HERDR_ENV === "1") {
  const { execFile } = await import("node:child_process");
  const execFileAsync = (file, args) =>
    new Promise((resolve) => {
      execFile(file, args, { encoding: "utf8", timeout: 15_000 }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          error: error ? error.message : null,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      });
    });

  const split = await execFileAsync("herdr", [
    "pane",
    "split",
    "--current",
    "--direction",
    "right",
    "--no-focus",
  ]);
  let paneId;
  try {
    paneId = JSON.parse(split.stdout).result?.pane?.pane_id;
  } catch {
    paneId = undefined;
  }
  if (!paneId) {
    failures.push(`herdr pane split failed: ${JSON.stringify(split).slice(0, 500)}`);
  } else {
    // Script file keeps markers out of the typed command line (wait-output
    // matches scrollback including the typed command).
    const { writeFile, rm } = await import("node:fs/promises");
    const cacheDir = join(homedir(), ".cache");
    await mkdir(cacheDir, { recursive: true });
    const scriptPath = join(cacheDir, `fabric-bin-probe-${process.pid}.sh`);
    const script = [
      "#!/bin/bash",
      "set -euo pipefail",
      `export PATH=${JSON.stringify(strippedPath)}`,
      'if command -v pi >/dev/null 2>&1; then echo bare_present; else echo bare_missing; fi',
      `${JSON.stringify(pinned.piBinary)} --version`,
      "echo PROBE_COMPLETE",
      "",
    ].join("\n");
    await writeFile(scriptPath, script, { mode: 0o700 });
    try {
      const ran = await execFileAsync("herdr", ["pane", "run", paneId, `bash ${JSON.stringify(scriptPath)}`]);
      if (!ran.ok) {
        failures.push(`herdr pane run failed: ${JSON.stringify(ran).slice(0, 500)}`);
      } else {
        const waited = await execFileAsync("herdr", [
          "pane",
          "wait-output",
          paneId,
          "--match",
          "PROBE_COMPLETE",
          "--source",
          "recent-unwrapped",
          "--timeout",
          "20000",
        ]);
        const read = await execFileAsync("herdr", [
          "pane",
          "read",
          paneId,
          "--source",
          "recent-unwrapped",
          "--lines",
          "80",
        ]);
        const blob = `${waited.stdout}\n${waited.stderr}\n${read.stdout}\n${read.stderr}`;
        if (!blob.includes("bare_missing")) {
          failures.push(`herdr pane probe did not prove bare pi missing: ${blob.slice(0, 1200)}`);
        } else if (!blob.includes("PROBE_COMPLETE") || !/\d+\.\d+\.\d+/.test(blob)) {
          failures.push(`herdr pane probe missing absolute pi version output: ${blob.slice(0, 1200)}`);
        } else {
          console.log("ok: herdr pane run absolute pi with stripped PATH; bare pi missing");
        }
      }
    } finally {
      await rm(scriptPath, { force: true });
    }
    await execFileAsync("herdr", ["pane", "close", paneId]);
  }
} else {
  console.log("note: HERDR_ENV not set; skipped herdr CLI probe");
}

if (failures.length) {
  console.error("FAIL\n" + failures.join("\n"));
  process.exit(1);
}
console.log("fabric-binaries live probe: all checks passed");
console.log("resolved", {
  pi: pinned.piBinary,
  node: pinned.nodeBinary,
  resolvePiBinary: resolvePiBinary(),
});
