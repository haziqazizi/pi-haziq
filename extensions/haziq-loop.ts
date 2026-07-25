import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import upstreamLoop from "../src/upstream-loop.js";

/**
 * Compatibility wrapper for pi-loop 0.2.0.
 *
 * Pi's shared event bus survives /reload. Upstream subscribes to `loop:fire`
 * without retaining the unsubscribe callback, so every reload adds another
 * delivery handler. Proxy only the event bus, capture every subscription, and
 * release it during session shutdown. All tools, commands, lifecycle hooks,
 * scheduling, and persistence remain owned by upstream pi-loop.
 */
export default function haziqLoop(pi: ExtensionAPI) {
  const subscriptions = new Set<() => void>();
  const events = {
    emit(channel: string, data: unknown) {
      pi.events.emit(channel, data);
    },
    on(channel: string, handler: (data: unknown) => void) {
      const unsubscribe = pi.events.on(channel, handler);
      let active = true;
      const wrapped = () => {
        if (!active) return;
        active = false;
        subscriptions.delete(wrapped);
        unsubscribe();
      };
      subscriptions.add(wrapped);
      return wrapped;
    },
  };

  const proxied = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "events") return events;
      return Reflect.get(target, property, receiver);
    },
  });

  upstreamLoop(proxied);

  pi.on("session_shutdown", () => {
    for (const unsubscribe of [...subscriptions]) unsubscribe();
    subscriptions.clear();
  });
}
