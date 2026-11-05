/** Application event bus. In-process today; keep callers on this interface so Redis/NATS can replace it later. */
export interface BusEvent {
  type: string;
}

export type Unsubscribe = () => void;

export interface EventBus<E extends BusEvent> {
  publish(event: E): void;
  subscribe<T extends E["type"]>(type: T, handler: (event: Extract<E, { type: T }>) => void): Unsubscribe;
  subscribeAll(handler: (event: E) => void): Unsubscribe;
}

export class InMemoryEventBus<E extends BusEvent> implements EventBus<E> {
  private byType = new Map<string, Set<(e: E) => void>>();
  private all = new Set<(e: E) => void>();

  constructor(private onHandlerError: (err: unknown, event: E) => void = () => {}) {}

  publish(event: E): void {
    const handlers = [...(this.byType.get(event.type) ?? []), ...this.all];
    for (const h of handlers) {
      try {
        h(event);
      } catch (err) {
        this.onHandlerError(err, event); // one bad consumer must not break the others
      }
    }
  }

  subscribe<T extends E["type"]>(type: T, handler: (event: Extract<E, { type: T }>) => void): Unsubscribe {
    const set = this.byType.get(type) ?? new Set();
    set.add(handler as (e: E) => void);
    this.byType.set(type, set);
    return () => set.delete(handler as (e: E) => void);
  }

  subscribeAll(handler: (event: E) => void): Unsubscribe {
    this.all.add(handler);
    return () => this.all.delete(handler);
  }
}
