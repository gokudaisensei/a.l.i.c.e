// X cards — see cards/x.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

function keys(body: unknown): string[] {
  return body && typeof body === "object" ? Object.keys(body as object).sort() : [];
}

function header(res: { headers: Record<string, string> }, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(res.headers)) if (k.toLowerCase() === lower) return v;
  return null;
}

function noLeak(text: string): boolean {
  return !/Service not found|Entity not found|Unauthorized|ECONNREFUSED|SQLITE|at [A-Za-z0-9_.]+\(/i.test(text);
}

function adminActor(ctx: ScenarioContext): Actor {
  const a = ctx.world.actors.admin;
  if (!a) throw new Error("world has no admin; the card needs world \"household\"");
  return a;
}

export const xCards: CardDef[] = [
  {
    id: "E2E-X-01",
    area: "X",
    title: "An unknown route returns the standard envelope with 404",
    capability: "404 + error envelope (API.md §Errors)",
    oracles: ["TS", "SPEC"],
    world: "fresh",
    run: async (ctx) => {
      const res = await ctx.call("x.unknown-route", "GET", "/api/v1/definitely-not-a-route");
      ctx.expectStatus("x.unknown-route", res, 404);
      ctx.add("the error envelope is the only top-level key", keys(res.body).join(",") === "error", "error", keys(res.body).join(","));
      ctx.add("the code is not_found", code(res.body) === "not_found", "not_found", code(res.body));
      const message = (res.body as any)?.error?.message;
      ctx.add("the message is human text", typeof message === "string" && message.length > 0, "non-empty string", typeof message);
      ctx.add("the message leaks nothing internal", noLeak(res.text), "clean", res.text.slice(0, 120));
    },
  },
  {
    id: "E2E-X-02",
    area: "X",
    title: "A known path with the wrong method does not fall through silently",
    capability: "Method handling (plan §4.14)",
    oracles: ["TS"],
    world: "fresh",
    run: async (ctx) => {
      const put = await ctx.call("x.wrong-method.put", "PUT", "/api/v1/auth/login/options", { body: {} });
      ctx.expectStatus("x.wrong-method.put", put, 404);
      ctx.add("the wrong method gets an envelope", !!code(put.body), "an error code", code(put.body));
      const patch = await ctx.call("x.wrong-method.patch", "PATCH", "/api/v1/auth/setup", { body: {} });
      ctx.expectStatus("x.wrong-method.patch", patch, 404);
      ctx.add("the second wrong method gets an envelope", !!code(patch.body), "an error code", code(patch.body));
    },
  },
  {
    id: "E2E-X-03",
    area: "X",
    title: "Authentication failures use the same envelope as any other error",
    capability: "401 envelope (API.md §Errors, SEC)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const household = await ctx.call("x.auth.household", "GET", "/api/v1/household");
      ctx.expectStatus("x.auth.household", household, 401);
      ctx.add("an anonymous household read is unauthenticated", code(household.body) === "unauthenticated", "unauthenticated", code(household.body));
      const me = await ctx.call("x.auth.me", "GET", "/api/v1/users/me");
      ctx.expectStatus("x.auth.me", me, 401);
      ctx.add("an anonymous profile read is unauthenticated", code(me.body) === "unauthenticated", "unauthenticated", code(me.body));
      const bogus = await ctx.call("x.auth.bogus-cookie", "GET", "/api/v1/users/me", { cookie: "alice_session=not-a-session" });
      ctx.expectStatus("x.auth.bogus-cookie", bogus, 401);
      ctx.add("a bogus cookie is refused, not crashed", code(bogus.body) === "unauthenticated", "unauthenticated", code(bogus.body));
      ctx.add("no body repeats the bogus cookie", !bogus.text.includes("not-a-session"), "clean", "checked");
      ctx.add("no stack frame appears", noLeak([household.text, me.text, bogus.text].join("\n")), "clean", "checked");
    },
  },
  {
    id: "E2E-X-04",
    area: "X",
    title: "Schema validation is validation_error with the same status",
    capability: "Validation errors (plan §4.14)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const admin = adminActor(ctx);
      const role = await admin.createInvitation({ role: "owner" as never });
      ctx.expectStatus("x.validation.role", role, 422);
      ctx.add("an invalid role is a validation error", code(role.body) === "validation_error", "validation_error", code(role.body));
      const colour = await admin.call("x.validation.colour", "PATCH", "/api/v1/users/me", { body: { avatarColor: 13 } });
      ctx.expectStatus("x.validation.colour", colour, 422);
      ctx.add("an out-of-range colour is a validation error", code(colour.body) === "validation_error", "validation_error", code(colour.body));
      const limit = await admin.call("x.validation.limit", "GET", "/api/v1/activity", { query: { limit: 500 } });
      ctx.expectStatus("x.validation.limit", limit, 422);
      ctx.add("an out-of-range limit is a validation error", code(limit.body) === "validation_error", "validation_error", code(limit.body));
    },
  },
  {
    id: "E2E-X-05",
    area: "X",
    title: "An allowed origin gets a CORS preflight answer",
    capability: "CORS allow (plan §4.14)",
    oracles: ["TS", "SPEC"],
    world: "fresh",
    headers: ["access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods"],
    run: async (ctx) => {
      const res = await ctx.call("x.cors.preflight.allowed", "OPTIONS", "/api/v1/auth/setup", {
        headers: {
          origin: ctx.side.origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      ctx.expectStatus("x.cors.preflight.allowed", res, [200, 204]);
      const allowOrigin = header(res, "access-control-allow-origin");
      ctx.add("the caller's origin is allowed", allowOrigin === ctx.side.origin, ctx.side.origin, allowOrigin);
      ctx.add("credentials are allowed", header(res, "access-control-allow-credentials") === "true", "true", header(res, "access-control-allow-credentials"));
      ctx.add("POST is an allowed method", (header(res, "access-control-allow-methods") ?? "").toUpperCase().includes("POST"), "POST", header(res, "access-control-allow-methods"));
    },
  },
  {
    id: "E2E-X-06",
    area: "X",
    title: "A denied origin gets no CORS grant",
    capability: "CORS deny (plan §4.14, SEC)",
    oracles: ["TS", "SEC"],
    world: "household",
    headers: ["access-control-allow-origin", "access-control-allow-credentials"],
    run: async (ctx) => {
      const evil = "http://evil.example";
      const res = await ctx.call("x.cors.preflight.denied", "OPTIONS", "/api/v1/auth/setup", {
        headers: { origin: evil, "access-control-request-method": "POST" },
      });
      // TS answers 204 with no allow-origin; Kotlin answers 405 for an OPTIONS it will not serve.
      // Both are denials; the status difference is recorded by the differential suite.
      ctx.expectStatus("x.cors.preflight.denied", res, [200, 204, 403, 405]);
      const allowOrigin = header(res, "access-control-allow-origin");
      ctx.add("the denied origin is not granted", allowOrigin !== evil && allowOrigin !== "*", "absent or null", allowOrigin ?? "absent");
      // TS still sends allow-credentials:true with no allow-origin; the grant is the allow-origin header.
      const post = await adminActor(ctx).call("x.cors.post.denied", "POST", "/api/v1/auth/login/options", { body: {}, origin: evil });
      ctx.expectStatus("x.cors.post.denied", post, 403);
      ctx.add("a cross-site write is blocked", code(post.body) === "csrf_blocked", "csrf_blocked", code(post.body));
    },
  },
  {
    id: "E2E-X-07",
    area: "X",
    title: "A non-JSON content type and malformed JSON are refused cleanly",
    capability: "Content-type handling (plan §4.14)",
    oracles: ["TS"],
    world: "fresh",
    run: async (ctx) => {
      const text = await ctx.call("x.content-type.text", "POST", "/api/v1/auth/login/options", {
        body: "{}",
        headers: { "content-type": "text/plain" },
      });
      ctx.add("a text/plain body is not a server error", text.status < 500, "<500", text.status);
      ctx.add("an error, if any, is an envelope", text.status < 400 || !!code(text.body), "envelope when refused", text.status < 400 ? "accepted" : code(text.body));
      const malformed = await ctx.call("x.content-type.malformed", "POST", "/api/v1/auth/login/options", {
        body: "{",
        headers: { "content-type": "application/json" },
      });
      ctx.expectStatus("x.content-type.malformed", malformed, 400);
      ctx.add("malformed JSON is a bad_request", code(malformed.body) === "bad_request", "bad_request", code(malformed.body));
      ctx.add("no stack frame appears", noLeak(malformed.text), "clean", "checked");
    },
  },
  {
    id: "E2E-X-08",
    area: "X",
    title: "A list endpoint paginates with limit and nextCursor",
    capability: "Pagination conventions (plan §4.14)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const admin = adminActor(ctx);
      const page = await admin.call("x.pagination.page", "GET", "/api/v1/activity", { query: { limit: 2 } });
      ctx.expectStatus("x.pagination.page", page, 200);
      ctx.add("the page has the documented keys", ["items", "nextCursor", "newCount"].every((k) => k in ((page.body as any) ?? {})), "items,nextCursor,newCount", keys(page.body).join(","));
      const items = ((page.body as any)?.items ?? []) as any[];
      ctx.add("the page respects the limit", items.length <= 2, "<=2", items.length);
      ctx.add("items have an id and a timestamp", items.every((i) => typeof i.id === "string" && typeof i.createdAt === "number"), "id+createdAt", "checked");
      ctx.add("nextCursor is a string or null", (page.body as any)?.nextCursor === null || typeof (page.body as any)?.nextCursor === "string", "string|null", typeof (page.body as any)?.nextCursor);
      const full = await admin.call("x.pagination.large", "GET", "/api/v1/activity", { query: { limit: 100 } });
      ctx.expectStatus("x.pagination.large", full, 200);
      const zero = await admin.call("x.pagination.zero", "GET", "/api/v1/activity", { query: { limit: 0 } });
      ctx.expectStatus("x.pagination.zero", zero, 422);
    },
  },
  {
    id: "E2E-X-09",
    area: "X",
    title: "JSON responses declare the same content type",
    capability: "Response headers (plan §4.14)",
    oracles: ["TS"],
    world: "fresh",
    run: async (ctx) => {
      const health = await ctx.call("x.headers.health", "GET", "/health");
      ctx.expectStatus("x.headers.health", health, 200);
      ctx.add("health is JSON", (header(health, "content-type") ?? "").toLowerCase().startsWith("application/json"), "application/json", header(health, "content-type"));
      const setup = await ctx.call("x.headers.setup", "GET", "/api/v1/auth/setup");
      ctx.add("a normal route is JSON", (header(setup, "content-type") ?? "").toLowerCase().startsWith("application/json"), "application/json", header(setup, "content-type"));
      const missing = await ctx.call("x.headers.error", "GET", "/api/v1/definitely-not-a-route");
      ctx.add("an error is JSON", (header(missing, "content-type") ?? "").toLowerCase().startsWith("application/json"), "application/json", header(missing, "content-type"));
    },
  },
  {
    id: "E2E-X-10",
    area: "X",
    title: "No error leaks an HA or server-internal string",
    capability: "Error text hygiene (plan §4.14, SEC)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const admin = adminActor(ctx);
      const bodies = [
        await ctx.call("x.hygiene.404", "GET", "/api/v1/definitely-not-a-route"),
        await admin.call("x.hygiene.validation", "PATCH", "/api/v1/users/me", { body: { avatarColor: 13 } }),
        await ctx.call("x.hygiene.unauthenticated", "GET", "/api/v1/household"),
      ];
      for (const [i, res] of bodies.entries()) {
        ctx.add(`error ${i + 1} parses as JSON`, header(res, "content-type")?.toLowerCase().includes("json") === true, "json", header(res, "content-type") ?? "none");
        ctx.add(`error ${i + 1} has only error/message/details`, keys(res.body).join(",") === "error" && Object.keys(((res.body as any)?.error ?? {})).every((k) => ["code", "message", "details"].includes(k)), "error envelope", keys(res.body).join(","));
        ctx.add(`error ${i + 1} leaks no internals`, noLeak(res.text), "clean", res.text.slice(0, 120));
      }
    },
  },
  {
    id: "E2E-X-11",
    area: "X",
    title: "OpenAPI, TRUST_PROXY, request-size and log hygiene",
    capability: "/docs, proxy trust, body limits, structured logs (plan §4.14)",
    oracles: ["SPEC"],
    blocked: "Kotlin has no /docs route in the T1.6 inventory, the harness runs no reverse proxy for TRUST_PROXY, neither API.md nor either implementation documents a request-size limit, and the log format/correlation id is not a wire contract.",
  },
];
