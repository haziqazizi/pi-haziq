import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piFabric from "pi-fabric";

export const FABRIC_CAPTURED_TOOLS_EVENT = "haziq:fabric-captured-tools:v1";

type FabricCommandHandler = (args: string, ctx: ExtensionContext) => Promise<void> | void;

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

export default async function haziqFabric(pi: ExtensionAPI) {
  let fabricCommand: FabricCommandHandler | undefined;

  const wrapped = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "on") {
        return (event: string, handler: (...args: unknown[]) => unknown) =>
          target.on(event as never, (async (...args: unknown[]) => {
            const result = await handler(...args);
            if (event !== "resources_discover" || !result || typeof result !== "object") return result;
            return { ...result, skillPaths: [] };
          }) as never);
      }
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
