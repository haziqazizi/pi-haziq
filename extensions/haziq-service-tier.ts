import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import upstreamServiceTier from "../src/upstream-service-tier.js";

type HookHandler = (event: unknown, ctx: ExtensionContext) => unknown;

function trustSafeContext<T extends ExtensionContext>(ctx: T): T {
  if (ctx.isProjectTrusted()) return ctx;
  const safeCwd = join(homedir(), ".pi", "agent");
  return new Proxy(ctx, {
    get(target, property, receiver) {
      if (property === "cwd") return safeCwd;
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * Trust gate for pi-openai-service-tier.
 *
 * Upstream supports project-over-global config but does not consult Pi project
 * trust. Proxy only ExtensionContext.cwd for untrusted projects, causing the
 * owner to resolve and persist against its global config while preserving all
 * provider registration, commands, status UI, and runtime state.
 */
export default function haziqServiceTier(pi: ExtensionAPI) {
  const proxied = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "on") {
        return (name: string, handler: HookHandler) =>
          (target.on as unknown as (name: string, handler: HookHandler) => void)(
            name,
            (event: unknown, ctx: ExtensionContext) => handler(event, trustSafeContext(ctx)),
          );
      }
      if (property === "registerCommand") {
        return (name: string, options: Record<string, unknown> & { handler: (args: string, ctx: ExtensionContext) => unknown }) =>
          target.registerCommand(name, {
            ...options,
            handler: (args: string, ctx: ExtensionContext) => options.handler(args, trustSafeContext(ctx)),
          } as never);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as ExtensionAPI;

  upstreamServiceTier(proxied);
}
