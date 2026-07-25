import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import haziqCohesion from "../extensions/haziq-cohesion.ts";
import { EXPECTED_TOOLS } from "../src/cohesion.ts";

test("notification command failures emit haziq:herdr-failed", async () => {
  const previous = {
    env: process.env.HERDR_ENV,
    pane: process.env.HERDR_PANE_ID,
    notifications: process.env.HAZIQ_COHESION_HERDR_NOTIFICATIONS,
  };
  process.env.HERDR_ENV = "1";
  process.env.HERDR_PANE_ID = "test-pane";
  process.env.HAZIQ_COHESION_HERDR_NOTIFICATIONS = "1";

  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
  const emitted: Array<{ channel: string; data: any }> = [];
  const pi = {
    on(name: string, handler: (event: any, ctx: ExtensionContext) => any) {
      const values = handlers.get(name) ?? [];
      values.push(handler);
      handlers.set(name, values);
    },
    registerCommand() {},
    appendEntry() {},
    getAllTools() {
      return EXPECTED_TOOLS.map((name) => ({ name, sourceInfo: { path: name === "mcp" ? "haziq-mcp.ts" : name } }));
    },
    getThinkingLevel() {
      return "high";
    },
    events: {
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data });
      },
      on() {
        return () => {};
      },
    },
    async exec(_command: string, args: string[]) {
      return { code: args[0] === "notification" ? 7 : 0, killed: false, stdout: "", stderr: "" };
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    cwd: "/tmp/project",
    hasUI: false,
    isProjectTrusted: () => true,
    model: {
      provider: "tokenmaxxing",
      id: "gpt-5.6-sol",
      api: "openai-responses",
      reasoning: true,
      input: ["text", "image"],
    },
    sessionManager: {
      getBranch: () => [],
      getSessionId: () => "session",
    },
    ui: { setStatus() {}, notify() {} },
  } as unknown as ExtensionContext;

  async function fire(name: string, event: unknown) {
    let result;
    for (const handler of handlers.get(name) ?? []) result = (await handler(event, ctx)) ?? result;
    return result;
  }

  try {
    haziqCohesion(pi);
    await fire("session_start", { reason: "startup" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await fire("tool_execution_start", { toolName: "workflow", toolCallId: "call", args: {} });
    await fire("tool_result", {
      toolName: "workflow",
      toolCallId: "call",
      isError: false,
      details: { runId: "run", background: true },
      content: [],
    });
    await fire("message_end", {
      message: {
        role: "custom",
        customType: "workflow-result",
        content: "✗ Background workflow run failed: boom",
        display: true,
        timestamp: Date.now(),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const failure = emitted.find((event) => event.channel === "haziq:herdr-failed");
    assert.ok(failure);
    assert.equal(failure.data.data.operation, "notification.show");
  } finally {
    if (previous.env === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.env;
    if (previous.pane === undefined) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous.pane;
    if (previous.notifications === undefined) delete process.env.HAZIQ_COHESION_HERDR_NOTIFICATIONS;
    else process.env.HAZIQ_COHESION_HERDR_NOTIFICATIONS = previous.notifications;
  }
});
