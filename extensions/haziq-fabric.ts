import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piFabric from "pi-fabric";
import { pinFabricLaunchBinaries } from "../src/fabric-binaries.ts";
import { ensureFabricHerdrSameTabTransport } from "../src/herdr-same-tab.ts";

export const FABRIC_CAPTURED_TOOLS_EVENT = "haziq:fabric-captured-tools:v1";

type FabricCommandHandler = (args: string, ctx: ExtensionContext) => Promise<void> | void;

/**
 * Actor/recursive Fabric workers already receive Fabric via `--fabric-extension`
 * (pi-fabric/dist/index.js). Loading haziq-fabric's piFabric() again registers a
 * second fabric_exec and crashes the child with a tool conflict.
 */
export function shouldHostPiFabric(env: NodeJS.ProcessEnv = process.env, hostedToolNames: string[] = []): boolean {
  if (env.PI_FABRIC_ACTOR_ID) return false;
  if (hostedToolNames.includes("fabric_exec")) return false;
  return true;
}

export function parseFabricCapturedToolNames(message: string): string[] {
  const names = message
    .split("\n")
    .map((line) => line.match(/^(\S+) \[[^\]]+\] — /)?.[1])
    .filter((name): name is string => typeof name === "string");
  return [...new Set(names)].sort();
}

function bindMember(target: object, property: PropertyKey, receiver: unknown): unknown {
  const value = Reflect.get(target, property, receiver);
  return typeof value === "function" ? value.bind(target) : value;
}

async function captureInventory(
  handler: FabricCommandHandler,
  ctx: ExtensionContext,
): Promise<string[]> {
  const messages: string[] = [];
  const ui = new Proxy(ctx.ui, {
    get(target, property, receiver) {
      if (property === "notify") {
        return (message: string) => {
          messages.push(message);
        };
      }
      return bindMember(target, property, receiver);
    },
  });
  const probeContext = new Proxy(ctx, {
    get(target, property, receiver) {
      if (property === "ui") return ui;
      return bindMember(target, property, receiver);
    },
  });
  await handler("captured", probeContext);
  return parseFabricCapturedToolNames(messages.join("\n"));
}

/**
 * pi-fabric persists mesh and journal state under `<projectRoot>/.pi/fabric`,
 * defaulting projectRoot to the launch cwd. When Pi starts in a directory that
 * cannot host that state (e.g. `/`), extension load crashes with EACCES.
 * Returns a writable global fallback root, or undefined when the cwd is fine
 * or the operator already pinned a root via env.
 */
export function fabricStateRootFallback(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string | undefined {
  if (env.PI_FABRIC_PROJECT_ROOT || env.PI_FABRIC_MESH_ROOT) return undefined;
  let probe = resolve(cwd, ".pi");
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  try {
    accessSync(probe, constants.W_OK);
    return undefined;
  } catch {
    return join(home, ".pi", "agent");
  }
}

export default async function haziqFabric(pi: ExtensionAPI) {
  // Herdr children: absolute pi + PATH injected on pane launch (no node wrapper).
  pinFabricLaunchBinaries();
  ensureFabricHerdrSameTabTransport();

  const fallbackRoot = fabricStateRootFallback(process.cwd());
  if (fallbackRoot) process.env.PI_FABRIC_PROJECT_ROOT = fallbackRoot;

  const hostedToolNames = typeof pi.getAllTools === "function"
    ? pi.getAllTools().map((tool) => tool.name)
    : [];
  const hostPiFabric = shouldHostPiFabric(process.env, hostedToolNames);

  // Pins/PATH/same-tab still apply to actor workers; do not re-host Fabric there.
  if (!hostPiFabric) {
    pi.on("session_start", async () => {
      pi.events.emit(FABRIC_CAPTURED_TOOLS_EVENT, {
        names: hostedToolNames.includes("fabric_exec") ? ["fabric_exec"] : [],
        status: "delegated",
      });
    });
    return;
  }

  let fabricCommand: FabricCommandHandler | undefined;

  // Pass through Fabric resource discovery unchanged so all packaged Fabric
  // skills (guide router + advanced workflows) remain visible. Capture still
  // hides non-fabric_exec tools from the model tool list.
  const wrapped = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerCommand") {
        return (name: string, options: { handler: FabricCommandHandler }) => {
          if (name === "fabric") fabricCommand = options.handler;
          return target.registerCommand(name, options as never);
        };
      }
      return bindMember(target, property, receiver);
    },
  }) as ExtensionAPI;

  await piFabric(wrapped);

  pi.on("session_start", async (_event, ctx) => {
    if (!fabricCommand) {
      pi.events.emit(FABRIC_CAPTURED_TOOLS_EVENT, { names: [], status: "unavailable" });
      return;
    }
    try {
      const names = await captureInventory(fabricCommand, ctx);
      pi.events.emit(FABRIC_CAPTURED_TOOLS_EVENT, { names });
    } catch {
      pi.events.emit(FABRIC_CAPTURED_TOOLS_EVENT, { names: [], status: "failed" });
    }
  });
}
