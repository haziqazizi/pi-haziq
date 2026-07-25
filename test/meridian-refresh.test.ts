import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMeridianRefresh } from "../extensions/haziq-meridian-refresh.ts";
import {
  createMeridianRefreshModels,
  formatMeridianRefreshStatus,
  isMeridianRefreshStatus,
  loadMeridianProviderSnapshot,
  parseMeridianCatalog,
  type MeridianRefreshStatus,
} from "../src/meridian-refresh.ts";

const staticModel = {
  id: "claude-opus-5",
  name: "Claude Opus 5 via Meridian",
  reasoning: true,
  thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" } as const,
  input: ["text", "image"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 128_000,
  compat: { forceAdaptiveThinking: true },
};

function modelsJson(headers: Record<string, string> = { "CF-Access-Client-Id": "$CF_ID" }) {
  return {
    providers: {
      meridian: {
        baseUrl: "https://meridian.example",
        api: "anthropic-messages",
        headers,
        compat: { forceAdaptiveThinking: true },
        models: [staticModel],
      },
    },
  };
}

function refreshContext(allowNetwork: boolean): RefreshModelsContext {
  return {
    allowNetwork,
    credential: { type: "api_key", key: "test-provider-key" },
    store: {
      read: async () => undefined,
      write: async () => undefined,
      delete: async () => undefined,
    },
  };
}

async function withConfig(
  value: unknown,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-haziq-meridian."));
  const path = join(dir, "models.json");
  try {
    await writeFile(path, JSON.stringify(value));
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loads only safe global Meridian model metadata", async () => {
  await withConfig(modelsJson(), async (path) => {
    const snapshot = loadMeridianProviderSnapshot(path);
    assert.ok(snapshot);
    assert.equal(snapshot.baseUrl, "https://meridian.example");
    assert.equal(snapshot.models[0]?.contextWindow, 200_000);
    assert.equal((snapshot.models[0]?.compat as { forceAdaptiveThinking?: boolean })?.forceAdaptiveThinking, true);
  });

  await withConfig(
    { ...modelsJson(), providers: { meridian: { ...modelsJson().providers.meridian, baseUrl: "http://public.example" } } },
    async (path) => assert.equal(loadMeridianProviderSnapshot(path), undefined),
  );
});

test("registers a refresh callback only when global Meridian configuration exists", async () => {
  await withConfig(modelsJson(), async (path) => {
    let providerName: string | undefined;
    let providerConfig: { refreshModels?: unknown } | undefined;
    const pi = {
      registerProvider(name: string, config: { refreshModels?: unknown }) {
        providerName = name;
        providerConfig = config;
      },
      on() {},
    } as unknown as ExtensionAPI;
    assert.equal(registerMeridianRefresh(pi, path), true);
    assert.equal(providerName, "meridian");
    assert.equal(typeof providerConfig?.refreshModels, "function");
  });
  const pi = {
    registerProvider: () => assert.fail("must not register"),
    on: () => assert.fail("must not listen"),
  } as unknown as ExtensionAPI;
  assert.equal(registerMeridianRefresh(pi, "/missing/models.json"), false);
});

test("ID-only catalogs filter the trusted static model list", () => {
  const models = parseMeridianCatalog(
    { data: [{ id: "claude-opus-5" }, { id: "claude-new-5" }] },
    [staticModel],
  );
  assert.deepEqual(models.map((model) => model.id), ["claude-opus-5"]);
  assert.equal(models[0]?.contextWindow, 200_000);
});

test("capability-bearing catalogs can safely add and resize models", () => {
  const models = parseMeridianCatalog(
    {
      data: [
        {
          id: "claude-opus-5",
          context_window: 1_000_000,
          max_output_tokens: 128_000,
        },
        {
          id: "claude-new-5",
          context_window: 500_000,
          max_output_tokens: 64_000,
          reasoning: true,
          input_modalities: ["text", "image", "audio"],
        },
      ],
    },
    [staticModel],
  );
  assert.deepEqual(models.map((model) => model.id), ["claude-new-5", "claude-opus-5"]);
  assert.equal(models.find((model) => model.id === "claude-opus-5")?.contextWindow, 1_000_000);
  const added = models.find((model) => model.id === "claude-new-5");
  assert.deepEqual(added?.input, ["text", "image"]);
  assert.equal((added?.compat as { forceAdaptiveThinking?: boolean })?.forceAdaptiveThinking, true);
});

test("malformed, duplicate, empty, and unsafe capability catalogs fail closed", () => {
  assert.throws(() => parseMeridianCatalog({ data: [] }, [staticModel]), /invalid shape/);
  assert.throws(
    () => parseMeridianCatalog({ data: [{ id: "claude-opus-5" }, { id: "claude-opus-5" }] }, [staticModel]),
    /duplicate/,
  );
  assert.throws(() => parseMeridianCatalog({ data: [{ id: "gpt-5" }] }, [staticModel]), /invalid model identifier/);
  assert.throws(
    () =>
      parseMeridianCatalog(
        { data: [{ id: "claude-opus-5", context_window: 100_000, max_output_tokens: 128_000 }] },
        [staticModel],
      ),
    /exceeds context/,
  );
});

test("formats and validates secret-safe refresh status", () => {
  const status: MeridianRefreshStatus = {
    version: 1,
    status: "succeeded",
    source: "network",
    timestamp: Date.parse("2026-07-25T18:10:00.000Z"),
    modelCount: 8,
    capabilityModelCount: 8,
  };
  assert.equal(isMeridianRefreshStatus(status), true);
  assert.equal(
    formatMeridianRefreshStatus(status),
    "network · 8 published models · 8 capability records · 2026-07-25T18:10:00.000Z",
  );
  assert.equal(isMeridianRefreshStatus({ ...status, modelCount: -1 }), false);
  assert.equal(isMeridianRefreshStatus({ ...status, status: "failed", error: "untrusted\ntext" }), false);
  assert.equal(
    formatMeridianRefreshStatus({ ...status, status: "failed", error: "HTTP 4xx" }),
    "failed (HTTP 4xx) · retained 8 models · 2026-07-25T18:10:00.000Z",
  );
});

test("refresh uses resolved auth without logging or persisting secrets", async () => {
  await withConfig(modelsJson({ "CF-Access-Client-Id": "$CF_ID", "x-meridian-agent": "pi" }), async (path) => {
    let request: Request | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return Response.json({ data: [{ id: "claude-opus-5" }] });
    }) as typeof fetch;
    const statuses: MeridianRefreshStatus[] = [];
    const refresh = createMeridianRefreshModels(path, {
      fetchImpl,
      env: { CF_ID: "test-access-id" },
      onStatus: (status) => statuses.push(status),
    });
    const models = await refresh(refreshContext(true));
    assert.equal(models.length, 1);
    assert.equal(request?.url, "https://meridian.example/v1/models");
    assert.equal(request?.headers.get("CF-Access-Client-Id"), "test-access-id");
    assert.equal(request?.headers.get("x-api-key"), "test-provider-key");
    assert.deepEqual(statuses.map((status) => status.status), ["refreshing", "succeeded"]);
    assert.equal(statuses[1]?.modelCount, 1);
    assert.equal(statuses[1]?.capabilityModelCount, 0);
  });
});

test("offline refresh preserves static models and does not call the network", async () => {
  await withConfig(modelsJson(), async (path) => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("must not run");
    }) as typeof fetch;
    const refresh = createMeridianRefreshModels(path, { fetchImpl });
    const models = await refresh(refreshContext(false));
    assert.equal(called, false);
    assert.deepEqual(models.map((model) => model.id), ["claude-opus-5"]);
  });
});

test("header commands and HTTP response bodies fail without exposing their values", async () => {
  await withConfig(modelsJson({ "CF-Access-Client-Secret": "!unsafe-command secret-value" }), async (path) => {
    const refresh = createMeridianRefreshModels(path, { fetchImpl: fetch });
    await assert.rejects(refresh(refreshContext(true)), /does not execute header commands/);
  });
  await withConfig(modelsJson({}), async (path) => {
    const fetchImpl = (async () => new Response("provider-secret-body", { status: 403 })) as typeof fetch;
    const statuses: MeridianRefreshStatus[] = [];
    const refresh = createMeridianRefreshModels(path, { fetchImpl, onStatus: (status) => statuses.push(status) });
    await assert.rejects(refresh(refreshContext(true)), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /provider-secret-body/);
      return true;
    });
    assert.equal(statuses.at(-1)?.status, "failed");
    assert.equal(statuses.at(-1)?.error, "HTTP 4xx");
  });
  await withConfig(modelsJson({}), async (path) => {
    const fetchImpl = (async () => new Response("x".repeat(1_000_001))) as typeof fetch;
    const refresh = createMeridianRefreshModels(path, { fetchImpl });
    await assert.rejects(refresh(refreshContext(true)), /exceeds the size limit/);
  });
});
