// HA-truth reader: reads Home Assistant directly, independently of either Alice backend.
import type { Recorder } from "./record.ts";

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context?: unknown;
}

export class HaClient {
  constructor(
    public readonly baseUrl: string,
    public readonly token: string,
    public readonly recorder?: Recorder,
  ) {}

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const started = Date.now();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {}
    this.recorder?.ha({
      method,
      path,
      status: res.status,
      body: body ?? null,
      response: parsed,
      ms: Date.now() - started,
    });
    if (!res.ok) throw new Error(`HA ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return parsed as T;
  }

  async states(): Promise<HaState[]> {
    return this.request<HaState[]>("GET", "/api/states");
  }

  async state(entityId: string): Promise<HaState> {
    return this.request<HaState>("GET", `/api/states/${encodeURIComponent(entityId)}`);
  }

  async callService(domain: string, service: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("POST", `/api/services/${domain}/${service}`, body);
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/config");
  }

  async renderTemplate(template: string): Promise<string> {
    return this.request<string>("POST", "/api/template", { template });
  }

  async entitiesMatching(re: RegExp): Promise<HaState[]> {
    return (await this.states()).filter((s) => re.test(s.entity_id));
  }

  async waitForState(
    entityId: string,
    predicate: (s: HaState) => boolean,
    timeoutMs = 10_000,
    intervalMs = 250,
  ): Promise<HaState> {
    const start = Date.now();
    let last: HaState | undefined;
    while (Date.now() - start < timeoutMs) {
      try {
        last = await this.state(entityId);
        if (predicate(last)) return last;
      } catch {}
      await Bun.sleep(intervalMs);
    }
    throw new Error(
      `HA state ${entityId} did not satisfy predicate within ${timeoutMs}ms (last=${last ? JSON.stringify(last.state) : "unreachable"})`,
    );
  }
}
