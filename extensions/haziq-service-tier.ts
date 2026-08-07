import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  SERVICE_TIER_STATUS_KEY,
  quietServiceTierStatusText,
} from "../src/service-tier-status.ts";
import upstreamServiceTier from "../src/upstream-service-tier.js";

export { quietServiceTierStatusText } from "../src/service-tier-status.ts";

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

function withQuietStatusUi<T extends ExtensionContext>(ctx: T): T {
  const trusted = trustSafeContext(ctx);
  return new Proxy(trusted, {
    get(target, property, receiver) {
      if (property === "ui") {
        const ui = target.ui;
        return new Proxy(ui, {
          get(uiTarget, uiProperty, uiReceiver) {
            if (uiProperty === "setStatus") {
              return (key: string, text: string | undefined) => {
                if (key === SERVICE_TIER_STATUS_KEY) {
                  return uiTarget.setStatus(key, quietServiceTierStatusText(text));
                }
                return uiTarget.setStatus(key, text);
              };
            }
            return Reflect.get(uiTarget, uiProperty, uiReceiver);
          },
        });
      }
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
 *
 * Also quiets footer status when the active tier does not apply to the model
 * (upstream otherwise prints a long "tier requested; unsupported …" line).
 */
export default function haziqServiceTier(pi: ExtensionAPI) {
  const proxied = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "on") {
        return (name: string, handler: HookHandler) =>
          (target.on as unknown as (name: string, handler: HookHandler) => void)(
            name,
            (event: unknown, ctx: ExtensionContext) => handler(event, withQuietStatusUi(ctx)),
          );
      }
      if (property === "registerCommand") {
        return (name: string, options: Record<string, unknown> & { handler: (args: string, ctx: ExtensionContext) => unknown }) =>
          target.registerCommand(name, {
            ...options,
            handler: (args: string, ctx: ExtensionContext) => options.handler(args, withQuietStatusUi(ctx)),
          } as never);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as ExtensionAPI;

  upstreamServiceTier(proxied);
}
