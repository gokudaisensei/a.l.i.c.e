import { Elysia, t } from "elysia";
import { requireMember } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Services } from "@/services";
import type { ClientSocket } from "./hub";

/**
 * Realtime endpoint: GET /ws (WebSocket upgrade). Authenticates with the same session cookie as the REST API,
 * then speaks the JSON protocol in docs/API.md. On reconnect a client resubscribes and refetches; there is no replay.
 */
export const realtimeController = ({ auth, households, realtime }: Services) =>
  new Elysia({ name: "realtime", tags: ["realtime"] })
    .use(sessionPlugin(auth, households))
    .ws("/ws", {
      body: t.Any(),
      maxPayloadLength: 16_384,
      idleTimeout: 120,
      // Runs on the upgrade request: refused here means no socket is ever opened.
      beforeHandle: (ctx) => { requireMember(ctx); },
      open(ws) {
        const { session, membership } = ws.data as unknown as { session: NonNullable<ReturnType<typeof requireMember>["session"]>; membership: NonNullable<ReturnType<typeof requireMember>["membership"]> };
        const socket: ClientSocket = {
          id: ws.id,
          send: (m) => { ws.send(JSON.stringify(m)); },
          close: (code, reason) => { ws.close(code, reason); },
          bufferedAmount: () => (ws.raw as unknown as { getBufferedAmount?: () => number }).getBufferedAmount?.() ?? 0,
        };
        realtime.connect(socket, session, membership);
      },
      message(ws, message) { realtime.receive(ws.id, message); },
      close(ws) { realtime.disconnect(ws.id); },
    });
