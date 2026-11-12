// Count Home Assistant `call_service` events for one entity (T4.2). The counter is independent of
// either backend: it subscribes to HA's own event stream, so it measures what really went on the wire.
import type { HaClient } from "./ha-truth.ts";

export interface ServiceCallCounter {
  count(): number;
  stop(): void;
}

export async function countServiceCalls(ha: HaClient, entityId: string, timeoutMs = 10_000): Promise<ServiceCallCounter> {
  const url = `${ha.baseUrl.replace(/^http/, "ws")}/api/websocket`;
  const ws = new WebSocket(url);
  let calls = 0;
  let id = 0;
  const subscribed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("HA event subscription timed out")), timeoutMs);
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: ha.token }));
      else if (m.type === "auth_invalid") reject(new Error("HA rejected the event subscription token"));
      else if (m.type === "auth_ok") ws.send(JSON.stringify({ id: ++id, type: "subscribe_events", event_type: "call_service" }));
      else if (m.type === "result" && m.id === id) {
        clearTimeout(timer);
        resolve();
      } else if (m.type === "event" && m.event?.event_type === "call_service") {
        const data = m.event.data ?? {};
        const target = data.service_data?.entity_id;
        const ids = Array.isArray(target) ? target : target ? [target] : [];
        if (ids.includes(entityId)) calls++;
      }
    };
    ws.onerror = () => reject(new Error("HA event subscription failed"));
  });
  await subscribed;
  return {
    count: () => calls,
    stop: () => {
      try {
        ws.close();
      } catch {}
    },
  };
}
