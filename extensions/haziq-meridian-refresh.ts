import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { createMeridianRefreshModels, loadMeridianProviderSnapshot } from "../src/meridian-refresh.ts";

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
  pi.registerProvider("meridian", {
    refreshModels: createMeridianRefreshModels(configPath, {
      getResolvedHeaders: () => resolvedHeaders,
    }),
  });
  const refreshActiveModel = async (model: Model<any> | undefined, ctx: ExtensionContext) => {
    if (!model || model.provider !== "meridian" || refreshing) return;
    refreshing = true;
    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) return;
      resolvedHeaders = auth.headers;
      await ctx.modelRegistry.refresh();
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
