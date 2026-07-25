import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMcpAdapter, loadMcpConfig } from "../src/upstream-mcp.js";

type HookHandler = (event: unknown, ctx: ExtensionContext) => unknown;

/**
 * Trust gate for pi-mcp-adapter.
 *
 * Upstream discovers cwd `.mcp.json` during extension construction and may
 * eagerly launch stdio servers before Pi resolves project trust. Install the
 * upstream adapter from session_start instead, supply a programmatic config,
 * and use project sources only after ctx.isProjectTrusted() says yes.
 */
export default function haziqMcp(pi: ExtensionAPI) {
  let installed = false;

  pi.on("session_start", async (event, ctx) => {
    if (installed) return;
    installed = true;

    const safeGlobalCwd = join(homedir(), ".pi", "agent");
    const configCwd = ctx.isProjectTrusted() ? ctx.cwd : safeGlobalCwd;
    const config = loadMcpConfig(undefined, configCwd);
    const pendingSessionStarts: Array<(event: unknown, ctx: ExtensionContext) => unknown> = [];

    const proxied = new Proxy(pi, {
      get(target, property, receiver) {
        if (property === "on") {
          return (name: string, handler: HookHandler) => {
            if (name === "session_start") {
              pendingSessionStarts.push(handler);
              return;
            }
            return (target.on as unknown as (name: string, handler: HookHandler) => void)(name, handler);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as ExtensionAPI;

    createMcpAdapter({ config })(proxied);
    for (const start of pendingSessionStarts) await start(event, ctx);
  });
}
