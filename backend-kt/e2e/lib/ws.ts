// WebSocket client with a timestamped transcript (runbook T1.1).
import type { Recorder } from "./record.ts";

export interface WsMessage {
  at: number;
  direction: "in" | "out";
  data: unknown;
}

export class WsClient {
  private ws?: WebSocket;
  private outbox: WsMessage[] = [];
  readonly messages: WsMessage[] = [];
  private waiters: { predicate: (m: any) => boolean; resolve: (m: any) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(
    public readonly url: string,
    public readonly stack: string = "ts",
    public readonly recorder?: Recorder,
    private readonly cookie?: string,
  ) {}

  connect(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use localhost (the configured WEBAUTHN_ORIGIN/CORS origin) rather than 127.0.0.1, so the
      // server's WebSocket origin check accepts the connection. Cookies are passed as a header.
      const url = this.url.replace("127.0.0.1", "localhost");
      const ws = new WebSocket(url, { headers: this.cookie ? { cookie: this.cookie } : {} } as any);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`WS connect timed out: ${this.url}`)), timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", (ev) => {
        clearTimeout(timer);
        reject(new Error(`WS error: ${String((ev as any).message ?? "error")}`));
      });
      ws.addEventListener("message", (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
        let data: unknown = raw;
        try {
          data = JSON.parse(raw);
        } catch {}
        const msg: WsMessage = { at: Date.now(), direction: "in", data };
        this.messages.push(msg);
        this.recorder?.ws(this.stack, msg as unknown as Record<string, unknown>);
        this.waiters = this.waiters.filter((w) => {
          if (w.predicate(data)) {
            clearTimeout(w.timer);
            w.resolve(data);
            return false;
          }
          return true;
        });
      });
      ws.addEventListener("close", (ev) => {
        this.recorder?.ws(this.stack, { at: Date.now(), direction: "in", data: { type: "close", code: ev.code, reason: ev.reason } });
      });
    });
  }

  send(obj: unknown): void {
    if (!this.ws) throw new Error("WS not connected");
    const data = JSON.stringify(obj);
    this.ws.send(data);
    const msg: WsMessage = { at: Date.now(), direction: "out", data: obj };
    this.messages.push(msg);
    this.recorder?.ws(this.stack, msg as unknown as Record<string, unknown>);
  }

  /** Send an already-serialised frame (used by the malformed-frame test). */
  sendRaw(text: string): void {
    if (!this.ws) throw new Error("WS not connected");
    this.ws.send(text);
    const msg: WsMessage = { at: Date.now(), direction: "out", data: text };
    this.messages.push(msg);
    this.recorder?.ws(this.stack, msg as unknown as Record<string, unknown>);
  }

  /** Resolve with the first message (including already-received ones) matching the predicate. */
  waitFor<T = any>(predicate: (m: any) => boolean, timeoutMs = 10_000, label = "message"): Promise<T> {
    const already = this.messages.find((m) => m.direction === "in" && predicate(m.data));
    if (already) return Promise.resolve(already.data as T);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`WS wait for ${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve: resolve as (m: any) => void, timer });
    });
  }

  /** Convenience: wait for a message whose `type` equals the given string. */
  waitForType<T = any>(type: string, timeoutMs = 10_000): Promise<T> {
    return this.waitFor<T>((m) => m?.type === type, timeoutMs, `type=${type}`);
  }

  close(code = 1000, reason = "test done"): void {
    this.ws?.close(code, reason);
    this.ws = undefined;
  }
}
