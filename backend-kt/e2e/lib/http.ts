// HTTP client with a per-actor cookie jar and full request/response recording (runbook T1.1).
import type { Recorder } from "./record.ts";

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  body: T;
  text: string;
  ms: number;
}

export class CookieJar {
  private cookies = new Map<string, string>();

  store(setCookies: string[]): void {
    for (const sc of setCookies) {
      const first = sc.split(";")[0]!;
      const eq = first.indexOf("=");
      if (eq === -1) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (!name) continue;
      if (value === "" || /Max-Age=0/i.test(sc)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  clear(): void {
    this.cookies.clear();
  }
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override the jar's cookie header (used to test the unauthenticated case). */
  cookie?: string | null;
  /** Send this Origin (default: the stack's localhost origin). `null` omits it. */
  origin?: string | null;
  /** Send this `X-Requested-With` value. `null` omits it (needed to prove the CSRF refusal). */
  requestedWith?: string | null;
  /** Do not parse JSON (returns text in body). */
  raw?: boolean;
}

export class HttpClient {
  readonly jar = new CookieJar();

  constructor(
    public readonly baseUrl: string,
    public readonly stack: string = "ts",
    public readonly recorder?: Recorder,
  ) {}

  private url(path: string, query?: RequestOptions["query"]): string {
    const u = new URL(path, this.baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<HttpResponse<T>> {
    // Same-origin default so cookie-authenticated writes pass the backend's CSRF check.
    const headers: Record<string, string> = {
      origin: this.baseUrl.replace("127.0.0.1", "localhost"),
      "x-requested-with": "XMLHttpRequest",
      ...(opts.headers ?? {}),
    };
    if (opts.origin === null) delete headers.origin;
    else if (opts.origin !== undefined) headers.origin = opts.origin;
    if (opts.requestedWith === null) delete headers["x-requested-with"];
    else if (opts.requestedWith !== undefined) headers["x-requested-with"] = opts.requestedWith;
    const cookie = opts.cookie === undefined ? this.jar.header() : opts.cookie ?? undefined;
    if (cookie) headers["cookie"] = cookie;
    let bodyText: string | undefined;
    if (opts.body !== undefined) {
      if (typeof opts.body === "string") bodyText = opts.body;
      else {
        bodyText = JSON.stringify(opts.body);
        headers["content-type"] ??= "application/json";
      }
    }
    const started = Date.now();
    const res = await fetch(this.url(path, opts.query), {
      method,
      headers,
      body: bodyText,
      redirect: "manual",
    });
    const ms = Date.now() - started;
    const text = await res.text();
    const setCookies = res.headers.getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    this.jar.store(setCookies);

    let body: unknown = text;
    if (!opts.raw) {
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
    }
    const headerObj: Record<string, string> = {};
    res.headers.forEach((v, k) => (headerObj[k] = v));

    this.recorder?.request(this.stack, {
      method,
      url: this.url(path, opts.query),
      requestHeaders: headers,
      requestBody: opts.body ?? null,
      status: res.status,
      responseHeaders: headerObj,
      responseBody: body,
      ms,
    });

    return { status: res.status, headers: headerObj, setCookies, body: body as T, text, ms };
  }

  get<T = unknown>(path: string, opts?: RequestOptions) {
    return this.request<T>("GET", path, opts);
  }
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>("POST", path, { ...opts, body });
  }
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>("PUT", path, { ...opts, body });
  }
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>("PATCH", path, { ...opts, body });
  }
  delete<T = unknown>(path: string, opts?: RequestOptions) {
    return this.request<T>("DELETE", path, opts);
  }
}
