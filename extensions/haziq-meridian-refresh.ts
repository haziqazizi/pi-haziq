import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
  MERIDIAN_REFRESH_STATUS_EVENT,
  createMeridianRefreshModels,
  loadMeridianProviderSnapshot,
  type MeridianRefreshStatus,
} from "../src/meridian-refresh.ts";

const MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");

function capabilitiesChanged(
  current: { contextWindow: number; maxTokens: number; reasoning: boolean; input: string[] },
  refreshed: { contextWindow: number; maxTokens: number; reasoning: boolean; input: string[] },
) {
  return (
    current.contextWindow !== refreshed.contextWindow ||
    current.maxTokens !== refreshed.maxTokens ||
    current.reasoning !== refreshed.reasoning ||
    current.input.join(",") !== refreshed.input.join(",")
  );
}

export function registerMeridianRefresh(pi: ExtensionAPI, configPath = MODELS_PATH) {
  const snapshot = loadMeridianProviderSnapshot(configPath);
  if (!snapshot) return false;
  let resolvedHeaders: Record<string, string> | undefined;
  let refreshing = false;
  const publishStatus = (status: MeridianRefreshStatus) => pi.events.emit(MERIDIAN_REFRESH_STATUS_EVENT, status);
  pi.registerProvider("meridian", {
    refreshModels: createMeridianRefreshModels(configPath, {
      getResolvedHeaders: () => resolvedHeaders,
      onStatus: publishStatus,
    }),
  });
  const refreshActiveModel = async (model: Model<any> | undefined, ctx: ExtensionContext) => {
    if (!model || model.provider !== "meridian" || refreshing) return;
    refreshing = true;
    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        publishStatus({
          version: 1,
          status: "failed",
          source: "static",
          timestamp: Date.now(),
          modelCount: snapshot.models.length,
          capabilityModelCount: 0,
          error: "auth unavailable",
        });
        return;
      }
      resolvedHeaders = auth.headers;
      try {
        await ctx.modelRegistry.refresh();
      } catch {
        publishStatus({
          version: 1,
          status: "failed",
          source: "static",
          timestamp: Date.now(),
          modelCount: snapshot.models.length,
          capabilityModelCount: 0,
          error: "config unavailable",
        });
        return;
      }
      const refreshed = ctx.modelRegistry.find("meridian", model.id);
      if (refreshed && capabilitiesChanged(model, refreshed)) await pi.setModel(refreshed);
    } finally {
      refreshing = false;
    }
  };
  pi.on("session_start", async (_event, ctx) => refreshActiveModel(ctx.model, ctx));
  pi.on("model_select", async (event, ctx) => refreshActiveModel(event.model, ctx));
  return true;
}

export default function haziqMeridianRefresh(pi: ExtensionAPI) {
  registerMeridianRefresh(pi);
}
