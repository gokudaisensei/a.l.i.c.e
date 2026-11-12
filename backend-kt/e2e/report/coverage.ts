// Route and WebSocket-message inventory (runbook T1.6). Scans the product trees read-only.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKEND_DIR, BACKEND_KT_DIR, E2E_DIR } from "../env/constants.ts";

export interface RouteEntry {
  method: string;
  path: string;
  module: string;
}

export interface WsEntry {
  type: string;
  source: string;
}

export interface RouteInventory {
  generatedAt: string;
  ts: RouteEntry[];
  kt: RouteEntry[];
  wsTypes: WsEntry[];
  onlyTs: RouteEntry[];
  onlyKt: RouteEntry[];
  counts: { ts: number; kt: number; ws: number; onlyTs: number; onlyKt: number };
}

function walk(dir: string, suffix: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, suffix));
    else if (full.endsWith(suffix)) out.push(full);
  }
  return out;
}

function joinPath(...parts: string[]): string {
  const p = parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return p.startsWith("/") ? p || "/" : `/${p}`;
}

const TS_METHODS = "get|post|put|patch|delete|head|options";

/** The prefix the module bundle is mounted under, read from `src/modules/index.ts`. */
function tsModulesPrefix(): string {
  try {
    const text = readFileSync(join(BACKEND_DIR, "src", "modules", "index.ts"), "utf8");
    return text.match(/new Elysia\(\{[^}]*prefix:\s*["'`]([^"'`]*)["'`]/s)?.[1] ?? "";
  } catch {
    return "";
  }
}

/** Read Elysia controllers and extract method + full path. */
export function scanTsRoutes(): RouteEntry[] {
  const files = [
    ...walk(join(BACKEND_DIR, "src"), ".ts").filter((f) => {
      const base = f.slice(f.lastIndexOf("/") + 1);
      return base === "controller.ts" || base.endsWith(".controller.ts");
    }),
    join(BACKEND_DIR, "src", "app.ts"),
  ].filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
  const modulesPrefix = tsModulesPrefix();
  const routes: RouteEntry[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // A file may export several controllers with different prefixes; scan each Elysia block with
    // its own prefix instead of taking the first prefix in the file for every route.
    const starts = [...text.matchAll(/new Elysia\(/g)].map((m) => m.index ?? 0);
    const blocks = (starts.length ? starts : [0]).map((start, i) => {
      const body = text.slice(start, starts[i + 1] ?? text.length);
      const prefix = body.match(/prefix:\s*["'`]([^"'`]*)["'`]/)?.[1] ?? "";
      return { prefix, body };
    });
    for (const block of blocks) {
      // Controllers under src/modules/ are mounted by buildModules() under its prefix; app.ts and
      // realtime/ are mounted directly on the root app.
      const mounted = file.includes("/src/modules/") ? joinPath(modulesPrefix, block.prefix) : block.prefix;
      const re = new RegExp(`\\.(${TS_METHODS})\\(\\s*["'\`]([^"'\`]*)["'\`]`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(block.body))) {
        routes.push({ method: m[1]!.toUpperCase(), path: joinPath(mounted, m[2]!), module: file.replace(BACKEND_DIR + "/", "") });
      }
    }
  }
  return dedupe(routes);
}

/** Read Ktor route blocks, resolving nested route("...") prefixes. */
export function scanKtRoutes(): RouteEntry[] {
  const dir = join(BACKEND_KT_DIR, "server", "src", "main", "kotlin", "alice", "server", "routes");
  const files = walk(dir, ".kt");
  const routes: RouteEntry[] = [];
  // Exactly one string argument -> a Ktor route call, not buildJsonObject's put("id", value).
  const methodWithPathRe = /\b(get|post|put|patch|delete)\s*\(\s*"([^"]*)"\s*\)/;
  // `get {` / `put {` registers the current route prefix itself.
  const methodNoPathRe = /\b(get|post|put|patch|delete)\s*\{\s*$/;
  const routeRe = /\broute\s*\(\s*"([^"]*)"\s*\)/;
  for (const file of files) {
    let depth = 0;
    const stack: { prefix: string; atDepth: number }[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const startDepth = depth;
      const prefix = stack.map((s) => s.prefix).join("");
      const method = line.match(methodWithPathRe);
      if (method) {
        routes.push({ method: method[1]!.toUpperCase(), path: joinPath(prefix, method[2]!), module: file.replace(BACKEND_KT_DIR + "/", "") });
      } else if (methodNoPathRe.test(line) && prefix) {
        routes.push({ method: line.trim().split(/\s|\(/)[0]!.toUpperCase(), path: joinPath(prefix), module: file.replace(BACKEND_KT_DIR + "/", "") });
      }
      const route = line.match(routeRe);
      if (route && line.includes("{")) stack.push({ prefix: route[1]!, atDepth: startDepth });
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      depth += opens - closes;
      while (stack.length > 0 && depth <= stack[stack.length - 1]!.atDepth) stack.pop();
    }
  }
  return dedupe(routes);
}

/** Compare `{id}` (Ktor) and `:id` (Elysia) as the same path parameter, ignoring a trailing slash. */
function normalizePathParam(path: string): string {
  const p = path.replace(/\{([^}]+)\}/g, ":$1").replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

function dedupe(routes: RouteEntry[]): RouteEntry[] {
  const seen = new Set<string>();
  return routes.filter((r) => {
    const k = `${r.method} ${normalizePathParam(r.path)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Extract dotted message types from the WebSocket section of API.md (best effort). */
export function scanWsTypes(): WsEntry[] {
  let text = "";
  try {
    text = readFileSync(join(BACKEND_DIR, "docs", "API.md"), "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /websocket/i.test(l));
  const section = start >= 0 ? lines.slice(start).join("\n") : text;
  const found = new Set<string>();
  const re = /\b([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) {
    // Ignore file/version-like tokens and common JSON paths.
    const t = m[1]!;
    if (/^(v\d|api\.)/.test(t)) continue;
    found.add(t);
  }
  return [...found].map((type) => ({ type, source: "backend/docs/API.md#websocket" }));
}

function routeKey(r: RouteEntry): string {
  return `${r.method} ${normalizePathParam(r.path)}`;
}

export function buildRouteInventory(): RouteInventory {
  const ts = scanTsRoutes();
  const kt = scanKtRoutes();
  const wsTypes = scanWsTypes();
  const ktKeys = new Set(kt.map(routeKey));
  const tsKeys = new Set(ts.map(routeKey));
  const onlyTs = ts.filter((r) => !ktKeys.has(routeKey(r)));
  const onlyKt = kt.filter((r) => !tsKeys.has(routeKey(r)));
  return {
    generatedAt: new Date().toISOString(),
    ts,
    kt,
    wsTypes,
    onlyTs,
    onlyKt,
    counts: { ts: ts.length, kt: kt.length, ws: wsTypes.length, onlyTs: onlyTs.length, onlyKt: onlyKt.length },
  };
}

export function writeRouteInventory(path = join(E2E_DIR, "route-inventory.json")): RouteInventory {
  const inv = buildRouteInventory();
  writeFileSync(path, JSON.stringify(inv, null, 2) + "\n");
  return inv;
}

if (import.meta.main) {
  const inv = writeRouteInventory();
  console.log(
    `route-inventory.json: TS ${inv.counts.ts} routes, Kotlin ${inv.counts.kt} routes, ` +
      `${inv.counts.ws} WS message types; only-TS ${inv.counts.onlyTs}, only-Kotlin ${inv.counts.onlyKt}`,
  );
}
