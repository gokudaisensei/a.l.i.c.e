/**
 * Runs a demo of the whole product behind one temporary Cloudflare tunnel (https://<random>.trycloudflare.com).
 *   bun scripts/demo.ts            start everything (builds the frontend the first time)
 *   bun scripts/demo.ts --build    rebuild the frontend first
 *   bun scripts/demo.ts --reseed   put the demo Home Assistant back to its seeded state (rooms, names, doors locked)
 * Press Ctrl+C to stop; it takes the tunnel and every process down. Data persists in backend/data/demo.db and the
 * demo Home Assistant's volume between runs (start over with: rm backend/data/demo.db*, bun run demo:ha:down).
 * Ports: 3190 (the one address the tunnel points at: routes /ws to the backend and the rest to the app), 3101 app, 3102 backend,
 * 8124 demo Home Assistant. None clash with the dev servers (3001/3002) or the test Home Assistant (8123).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BACKEND = join(import.meta.dir, "..");
const FRONTEND = join(BACKEND, "../frontend");
const PROXY_PORT = 3190, APP_PORT = 3101, API_PORT = 3102, HA_PORT = 8124;
const HA_URL = `http://127.0.0.1:${HA_PORT}`;
const HA_ENV = join(BACKEND, ".env.demo");
const KEYS_ENV = join(BACKEND, ".env.demo-keys");
const args = new Set(process.argv.slice(2));

const children: Bun.Subprocess[] = [];
const say = (m: string) => console.log(`\x1b[1m[demo]\x1b[0m ${m}`);
const stop = () => { for (const c of children) try { c.kill(); } catch {} };
process.on("SIGINT", () => { say("Stopping."); stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
const fail = (m: string): never => { console.error(`\x1b[31m[demo] ${m}\x1b[0m`); stop(); process.exit(1); };

async function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const p = Bun.spawn(cmd, { cwd: opts.cwd ?? BACKEND, env: { ...process.env, ...opts.env }, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) fail(`${cmd.join(" ")} failed`);
}
function start(name: string, cmd: string[], opts: { cwd?: string; env?: Record<string, string> }) {
  const p = Bun.spawn(cmd, { cwd: opts.cwd ?? BACKEND, env: { ...process.env, ...opts.env }, stdout: "pipe", stderr: "pipe" });
  children.push(p);
  const tag = (s: ReadableStream<Uint8Array>) => s.pipeTo(new WritableStream({ write(b) { for (const l of new TextDecoder().decode(b).split("\n")) if (l.trim()) console.log(`\x1b[2m[${name}]\x1b[0m ${l}`); } }));
  void tag(p.stdout as ReadableStream<Uint8Array>); void tag(p.stderr as ReadableStream<Uint8Array>);
  void p.exited.then((c) => { if (c !== 0 && c !== null) say(`${name} exited with ${c}`); });
  return p;
}
async function waitFor(url: string, what: string, ms = 180_000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if ((await fetch(url)).status < 500) return; } catch {} await Bun.sleep(1500); }
  fail(`${what} did not come up`);
}

// 1. Keys (made once, kept in a git-ignored file).
if (!existsSync(KEYS_ENV)) {
  say("Making keys (once)…");
  const out = Bun.spawnSync(["bun", "scripts/generate-keys.ts"], { cwd: BACKEND }).stdout.toString();
  writeFileSync(KEYS_ENV, out.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).join("\n") + "\n");
}
const keys = Object.fromEntries(readFileSync(KEYS_ENV, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { ADMIN_SEAL_PRIVATE_KEY, UPDATE_SIGNING_PRIVATE_KEY: _unused, ...serverKeys } = keys;
void _unused;

// 2. The demo Home Assistant, onboarded and seeded.
say("Starting the demo Home Assistant (port 8124)…");
await run(["docker", "compose", "-f", "dev/ha/demo/docker-compose.yml", "up", "-d"]);
await waitFor(`${HA_URL}/api/onboarding`, "Home Assistant");
const fresh = !existsSync(HA_ENV);
if (fresh) { say("Onboarding Home Assistant…"); await run(["bun", "dev/ha/bootstrap.ts"], { env: { HA_URL, ENV_FILE: HA_ENV } }); }
if (fresh || args.has("--reseed")) { say("Seeding rooms and devices…"); await run(["bun", "dev/ha/seed-home.ts"], { env: { ENV_FILE: HA_ENV, DEMO: "1" } }); }
const ha = Object.fromEntries(readFileSync(HA_ENV, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

// 3. The frontend, built once. The address of the backend is fixed into the build; the socket address is "same-origin".
const DIST = ".next-demo";
/** The newest change under the front end's source, public files and config: a build older than it is out of date. */
function newestSource(dir: string, newest = 0): number {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    newest = e.isDirectory() ? newestSource(f, newest) : Math.max(newest, statSync(f).mtimeMs);
  }
  return newest;
}
const built = join(FRONTEND, DIST, "BUILD_ID");
const stale = existsSync(built) && Math.max(newestSource(join(FRONTEND, "src")), newestSource(join(FRONTEND, "public")), statSync(join(FRONTEND, "package.json")).mtimeMs) > statSync(built).mtimeMs;
if (args.has("--build") || stale || !existsSync(built)) {
  say(stale ? "The front end changed since the last build; rebuilding (a minute or two)…" : "Building the frontend (a minute or two)…");
  await run(["bun", "run", "build"], { cwd: FRONTEND, env: { NEXT_DIST_DIR: DIST, NEXT_PUBLIC_WS_URL: "same-origin", BACKEND_URL: `http://localhost:${API_PORT}`, NODE_ENV: "production" } });
}

// 4. The one address the tunnel points at: /ws goes to the backend, everything else to the app.
type WsData = { cookie: string; origin: string; up?: WebSocket; queue: (string | Uint8Array)[] };
Bun.serve<WsData>({
  port: PROXY_PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: { cookie: req.headers.get("cookie") ?? "", origin: req.headers.get("origin") ?? "", queue: [] } })) return undefined;
      return new Response("expected a websocket", { status: 400 });
    }
    const headers = new Headers(req.headers);
    headers.set("x-forwarded-host", url.host);
    try {
      const r = await fetch(`http://127.0.0.1:${APP_PORT}${url.pathname}${url.search}`, { method: req.method, headers, body: req.body, redirect: "manual", duplex: "half" } as RequestInit);
      // fetch has already unzipped the body, so the headers that describe the zipped one must go.
      const out = new Headers(r.headers); out.delete("content-encoding"); out.delete("content-length");
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
    } catch { return new Response("The app is not ready yet. Try again in a moment.", { status: 502 }); }
  },
  websocket: {
    open(ws) {
      const up = new WebSocket(`ws://127.0.0.1:${API_PORT}/ws`, { headers: { cookie: ws.data.cookie, origin: ws.data.origin } } as never);
      ws.data.up = up;
      up.onopen = () => { for (const m of ws.data.queue) up.send(m); ws.data.queue = []; };
      up.onmessage = (e) => ws.send(e.data as string);
      up.onclose = () => ws.close();
      up.onerror = () => ws.close();
    },
    message(ws, m) { if (ws.data.up?.readyState === WebSocket.OPEN) ws.data.up.send(m); else ws.data.queue.push(m); },
    close(ws) { ws.data.up?.close(); },
  },
});

// 5. The tunnel first (we need its address for sign-in), then Alice.
say("Opening the tunnel…");
const tunnel = Bun.spawn(["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PROXY_PORT}`], { stdout: "pipe", stderr: "pipe" });
children.push(tunnel);
const origin = await new Promise<string>((resolve) => {
  const timer = setTimeout(() => fail("The tunnel did not give an address in 60 seconds (is there a network?)"), 60_000);
  const scan = (s: ReadableStream<Uint8Array>) => s.pipeTo(new WritableStream({ write(b) { const m = new TextDecoder().decode(b).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) { clearTimeout(timer); resolve(m[0]); } } }));
  void scan(tunnel.stdout as ReadableStream<Uint8Array>); void scan(tunnel.stderr as ReadableStream<Uint8Array>);
});
const host = new URL(origin).hostname;

const common = { DATABASE_URL: "./data/demo.db", NODE_ENV: "production", LOG_LEVEL: "info" };
start("backend", ["bun", "src/index.ts"], { env: { ...common, ...serverKeys, PORT: String(API_PORT), WEBAUTHN_RP_ID: host, WEBAUTHN_ORIGIN: origin, CORS_ORIGINS: origin, TRUST_PROXY: "true", VAPID_SUBJECT: "mailto:demo@example.com", UPDATE_MANIFEST_URL: "" } });
start("worker", ["bun", "src/worker/index.ts"], { env: { ...common, ADMIN_SEAL_PRIVATE_KEY: ADMIN_SEAL_PRIVATE_KEY! } });
start("app", ["bunx", "next", "start", "-p", String(APP_PORT)], { cwd: FRONTEND, env: { NEXT_DIST_DIR: DIST, BACKEND_URL: `http://localhost:${API_PORT}`, NODE_ENV: "production" } });
await waitFor(`http://127.0.0.1:${API_PORT}/health`, "the backend").catch(() => waitFor(`http://127.0.0.1:${API_PORT}/`, "the backend"));
await waitFor(`http://127.0.0.1:${APP_PORT}/`, "the app");
// The tunnel needs a moment before its address answers.
for (let i = 0; i < 20; i++) { try { if ((await fetch(origin)).status < 500) break; } catch {} await Bun.sleep(1500); }

console.log(`
\x1b[1m┌──────────────────────────────────────────────────────────────┐
│  Alice demo is up                                            │
└──────────────────────────────────────────────────────────────┘\x1b[0m
  Open:  \x1b[1m${origin}\x1b[0m   (changes every run; passkeys are tied to it)

  First time on this database:
   1. Open the link and create the first user (this person becomes the household admin).
   2. The setup then asks for Home Assistant. Enter
        Address  ${HA_URL}
        Token    ${ha.HA_TOKEN}
  Try the gestures and haptics (best on an Android phone in Chrome; the page must be on https, which this is):
   - In the app: tap the account button, then turn "Haptics" on or off (it is per device). Drag the switch thumb, swipe across
     segmented controls and tabs, scrub the number on a stepper, drag a lamp or blind tile past its end, hold a tile, swipe a toast away.
   - The component library needs no sign-in: \x1b[1m${origin}/library\x1b[0m. Open "Haptics" under Foundations (the "Try them" page has
     one button per haptic and a setting) and "Gestures" (what each component does under a finger).
   - iPhone: the vibration path has never run on one; Safari may do nothing.
  Passkeys registered on an earlier tunnel address will not work on a new one; for a repeat demo start fresh with
  rm backend/data/demo.db* (the Home Assistant keeps its devices).

  Ctrl+C stops everything.
`);
await new Promise(() => {});
