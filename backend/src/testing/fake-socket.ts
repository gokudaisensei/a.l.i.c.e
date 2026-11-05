import type { ClientSocket, ServerMessage } from "@/realtime/hub";

/** A socket that records what the hub sends, for tests. */
export class FakeSocket implements ClientSocket {
  messages: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  buffered = 0;
  constructor(public id: string) {}
  send(m: ServerMessage) { this.messages.push(m); }
  close(code: number, reason: string) { this.closed = { code, reason }; }
  bufferedAmount() { return this.buffered; }
  types() { return this.messages.map((m) => m.type); }
  of(type: string) { return this.messages.filter((m) => m.type === type); }
  clear() { this.messages = []; }
}
