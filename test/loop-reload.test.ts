import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import haziqLoop from "../extensions/haziq-loop.ts";

class TestBus {
  readonly emitter = new EventEmitter();

  emit(channel: string, data: unknown) {
    this.emitter.emit(channel, data);
  }

  on(channel: string, handler: (data: unknown) => void) {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  count(channel: string) {
    return this.emitter.listenerCount(channel);
  }
}

function fakePi(bus: TestBus) {
  const lifecycle = new Map<string, Array<(event: unknown, ctx?: unknown) => unknown>>();
  const pi = {
    events: bus,
    on(name: string, handler: (event: unknown, ctx?: unknown) => unknown) {
      const handlers = lifecycle.get(name) ?? [];
      handlers.push(handler);
      lifecycle.set(name, handlers);
    },
    registerTool() {},
    registerCommand() {},
    sendUserMessage() {},
  } as unknown as ExtensionAPI;
  return { pi, lifecycle };
}

async function shutdown(lifecycle: Map<string, Array<(event: unknown) => unknown>>) {
  for (const handler of lifecycle.get("session_shutdown") ?? []) {
    await handler({ reason: "reload" });
  }
}

test("pi-loop shared-bus subscriptions do not accumulate across reload generations", async () => {
  const bus = new TestBus();

  const first = fakePi(bus);
  haziqLoop(first.pi);
  assert.equal(bus.count("loop:fire"), 1);
  await shutdown(first.lifecycle);
  assert.equal(bus.count("loop:fire"), 0);

  const second = fakePi(bus);
  haziqLoop(second.pi);
  assert.equal(bus.count("loop:fire"), 1);
  await shutdown(second.lifecycle);
  assert.equal(bus.count("loop:fire"), 0);
});
