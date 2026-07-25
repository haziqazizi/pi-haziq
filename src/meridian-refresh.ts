import { readFileSync } from "node:fs";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { RefreshModelsContext } from "@earendil-works/pi-ai";

const MODEL_ID_PATTERN = /^claude-[a-z0-9][a-z0-9.-]{0,126}$/;
const MAX_CATALOG_MODELS = 100;
const MAX_CATALOG_BYTES = 1_000_000;
const MIN_CONTEXT_TOKENS = 16_384;
const MAX_CONTEXT_TOKENS = 2_000_000;
const MAX_OUTPUT_TOKENS = 256_000;

interface JsonObject {
  [key: string]: unknown;
}

export interface MeridianProviderSnapshot {
  baseUrl: string;
  headers: Record<string, string>;
  models: ProviderModelConfig[];
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function zeroCost(): ProviderModelConfig["cost"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function modelCost(value: unknown): ProviderModelConfig["cost"] {
  if (!isObject(value)) return zeroCost();
  const fields = [value.input, value.output, value.cacheRead, value.cacheWrite];
  if (fields.some((field) => typeof field !== "number" || !Number.isFinite(field) || field < 0)) return zeroCost();
  return {
    input: value.input as number,
    output: value.output as number,
    cacheRead: value.cacheRead as number,
    cacheWrite: value.cacheWrite as number,
  };
}

function validBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function positiveInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function inputTypes(value: unknown, fallback: ("text" | "image")[]): ("text" | "image")[] {
  if (!Array.isArray(value)) return fallback;
  const accepted = [...new Set(value.filter((item): item is "text" | "image" => item === "text" || item === "image"))];
  return accepted.length > 0 ? accepted : fallback;
}

function parseStaticModel(value: unknown, providerCompat: unknown): ProviderModelConfig | undefined {
  if (!isObject(value) || typeof value.id !== "string" || !MODEL_ID_PATTERN.test(value.id)) return undefined;
  const contextWindow = positiveInteger(value.contextWindow, MIN_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS);
  const maxTokens = positiveInteger(value.maxTokens, 1, MAX_OUTPUT_TOKENS);
  if (!contextWindow || !maxTokens || maxTokens > contextWindow) return undefined;
  const compat = {
    ...(isObject(providerCompat) ? providerCompat : {}),
    ...(isObject(value.compat) ? value.compat : {}),
  } as ProviderModelConfig["compat"];
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : value.id,
    reasoning: value.reasoning === true,
    thinkingLevelMap: isObject(value.thinkingLevelMap)
      ? (value.thinkingLevelMap as ProviderModelConfig["thinkingLevelMap"])
      : undefined,
    input: inputTypes(value.input, ["text"]),
    cost: modelCost(value.cost),
    contextWindow,
    maxTokens,
    compat,
  };
}

export function loadMeridianProviderSnapshot(path: string): MeridianProviderSnapshot | undefined {
  try {
    const root = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isObject(root) || !isObject(root.providers) || !isObject(root.providers.meridian)) return undefined;
    const provider = root.providers.meridian;
    const baseUrl = validBaseUrl(provider.baseUrl);
    if (!baseUrl || !Array.isArray(provider.models)) return undefined;
    if (provider.models.length > MAX_CATALOG_MODELS) return undefined;
    const models = provider.models
      .map((model) => parseStaticModel(model, provider.compat))
      .filter((model): model is ProviderModelConfig => model !== undefined);
    if (models.length === 0 || new Set(models.map((model) => model.id)).size !== models.length) return undefined;
    const headers = isObject(provider.headers)
      ? Object.fromEntries(
          Object.entries(provider.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : {};
    return { baseUrl, headers, models };
  } catch {
    return undefined;
  }
}

function catalogInteger(item: JsonObject, camel: string, snake: string, minimum: number, maximum: number) {
  const raw = item[camel] ?? item[snake];
  if (raw === undefined) return undefined;
  const parsed = positiveInteger(raw, minimum, maximum);
  if (parsed === undefined) throw new Error(`Meridian catalog has invalid ${snake}`);
  return parsed;
}

function modelFromCatalog(
  item: JsonObject,
  fallback: ProviderModelConfig | undefined,
  providerDefaults: ProviderModelConfig | undefined,
): ProviderModelConfig | undefined {
  const contextWindow = catalogInteger(
    item,
    "contextWindow",
    "context_window",
    MIN_CONTEXT_TOKENS,
    MAX_CONTEXT_TOKENS,
  );
  const maxTokens = catalogInteger(item, "maxTokens", "max_output_tokens", 1, MAX_OUTPUT_TOKENS);
  if (!fallback && (contextWindow === undefined || maxTokens === undefined)) return undefined;
  const resolvedContext = contextWindow ?? fallback!.contextWindow;
  const resolvedOutput = maxTokens ?? fallback!.maxTokens;
  if (resolvedOutput > resolvedContext) throw new Error("Meridian catalog output limit exceeds context window");
  return {
    id: item.id as string,
    name: typeof item.name === "string" && item.name.trim() ? item.name : (fallback?.name ?? (item.id as string)),
    reasoning: typeof item.reasoning === "boolean" ? item.reasoning : (fallback?.reasoning ?? false),
    thinkingLevelMap: fallback?.thinkingLevelMap,
    input: inputTypes(item.input ?? item.input_modalities, fallback?.input ?? ["text"]),
    cost: fallback?.cost ?? zeroCost(),
    contextWindow: resolvedContext,
    maxTokens: resolvedOutput,
    compat: fallback?.compat ?? providerDefaults?.compat,
  };
}

export function parseMeridianCatalog(payload: unknown, staticModels: ProviderModelConfig[]): ProviderModelConfig[] {
  if (!isObject(payload) || !Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error("Meridian catalog has an invalid shape");
  }
  if (payload.data.length > MAX_CATALOG_MODELS) throw new Error("Meridian catalog exceeds the model limit");
  const fallbacks = new Map(staticModels.map((model) => [model.id, model]));
  const providerDefaults = staticModels[0];
  const seen = new Set<string>();
  const models: ProviderModelConfig[] = [];
  for (const raw of payload.data) {
    if (!isObject(raw) || typeof raw.id !== "string" || !MODEL_ID_PATTERN.test(raw.id)) {
      throw new Error("Meridian catalog contains an invalid model identifier");
    }
    if (seen.has(raw.id)) throw new Error("Meridian catalog contains duplicate model identifiers");
    seen.add(raw.id);
    const model = modelFromCatalog(raw, fallbacks.get(raw.id), providerDefaults);
    if (model) models.push(model);
  }
  if (models.length === 0) {
    throw new Error("Meridian catalog contains no models with trusted capability metadata");
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function resolveHeaderValue(value: string, env: NodeJS.ProcessEnv): string {
  if (value.startsWith("!")) throw new Error("Meridian refresh does not execute header commands");
  const braced = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)?.[1];
  const plain = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
  const variable = braced ?? plain;
  if (!variable) return value;
  const resolved = env[variable];
  if (!resolved) throw new Error("Meridian refresh header environment variable is unavailable");
  return resolved;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
    throw new Error("Meridian catalog response exceeds the size limit");
  }
  if (!response.body) throw new Error("Meridian catalog returned an empty response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_CATALOG_BYTES) {
      await reader.cancel();
      throw new Error("Meridian catalog response exceeds the size limit");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Meridian catalog returned invalid JSON");
  }
}

export interface MeridianRefreshOptions {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  getResolvedHeaders?: () => Record<string, string> | undefined;
}

export function createMeridianRefreshModels(
  configPath: string,
  options: MeridianRefreshOptions = {},
): (context: RefreshModelsContext) => Promise<ProviderModelConfig[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  let lastSuccess: { at: number; models: ProviderModelConfig[] } | undefined;
  let inFlight: Promise<ProviderModelConfig[]> | undefined;
  return async (context) => {
    const snapshot = loadMeridianProviderSnapshot(configPath);
    if (!snapshot) throw new Error("Meridian provider configuration is unavailable");
    if (!context.allowNetwork) return lastSuccess?.models ?? snapshot.models;
    if (!context.force && lastSuccess && Date.now() - lastSuccess.at < 60_000) return lastSuccess.models;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (context.credential?.type !== "api_key" || !context.credential.key) {
        throw new Error("Meridian refresh credential is unavailable");
      }
      const headers = new Headers({ Accept: "application/json" });
      const resolvedHeaders = options.getResolvedHeaders?.();
      if (options.getResolvedHeaders && Object.keys(snapshot.headers).length > 0 && !resolvedHeaders) {
        throw new Error("Meridian refresh headers are unavailable");
      }
      for (const [name, value] of Object.entries(resolvedHeaders ?? snapshot.headers)) {
        headers.set(name, resolvedHeaders ? value : resolveHeaderValue(value, env));
      }
      headers.set("x-api-key", context.credential.key);
      const timeout = AbortSignal.timeout(10_000);
      const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await fetchImpl(`${snapshot.baseUrl}/v1/models`, { headers, signal });
      } catch {
        throw new Error("Meridian catalog request failed");
      }
      if (!response.ok) throw new Error(`Meridian catalog request failed with HTTP ${response.status}`);
      const payload = await readBoundedJson(response);
      const models = parseMeridianCatalog(payload, snapshot.models);
      lastSuccess = { at: Date.now(), models };
      return models;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  };
}
