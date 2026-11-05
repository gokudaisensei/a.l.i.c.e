/**
 * Onboards a fresh test HA instance and mints a long-lived access token.
 * Usage: bun dev/ha/bootstrap.ts   (writes backend/.env.test)
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.HA_URL ?? "http://127.0.0.1:8123";
const CLIENT_ID = `${BASE}/`;
const USER = { name: "Test Admin", username: "admin", password: "alice-test-only", language: "en" };

async function waitForHa(timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/onboarding`);
      if (r.ok || r.status === 404) return r;
    } catch {}
    await Bun.sleep(2000);
  }
  throw new Error("Home Assistant did not become ready");
}

async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json() as Promise<any>;
}

async function exchangeCode(code: string): Promise<string> {
  const r = await fetch(`${BASE}/auth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: CLIENT_ID }),
  });
  if (!r.ok) throw new Error(`/auth/token -> ${r.status} ${await r.text()}`);
  return ((await r.json()) as any).access_token;
}

function mintLongLivedToken(accessToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/websocket`);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: accessToken }));
      else if (msg.type === "auth_ok")
        ws.send(JSON.stringify({ id: 1, type: "auth/long_lived_access_token", client_name: "alice-tests", lifespan: 3650 }));
      else if (msg.type === "result" && msg.id === 1) {
        ws.close();
        msg.success ? resolve(msg.result) : reject(new Error(JSON.stringify(msg.error)));
      } else if (msg.type === "auth_invalid") reject(new Error("auth_invalid"));
    };
    ws.onerror = () => reject(new Error("websocket error"));
  });
}

await waitForHa();
const status = (await (await fetch(`${BASE}/api/onboarding`)).json()) as { step: string; done: boolean }[];
const userStep = status.find((s) => s.step === "user");
if (!userStep || userStep.done) {
  throw new Error("HA is already onboarded; run `docker compose -f dev/ha/docker-compose.yml down -v` and retry.");
}

const { auth_code } = await post("/api/onboarding/users", { client_id: CLIENT_ID, ...USER });
const accessToken = await exchangeCode(auth_code);

// Finish the remaining onboarding steps so HA behaves like a configured install.
for (const step of ["core_config", "analytics"]) {
  await post(`/api/onboarding/${step}`, {}, accessToken).catch(() => {});
}
await post("/api/onboarding/integration", { client_id: CLIENT_ID, redirect_uri: `${BASE}/?auth_callback=1` }, accessToken).catch(() => {});

const token = await mintLongLivedToken(accessToken);
const out = join(import.meta.dir, "../../.env.test");
writeFileSync(out, `HA_URL=${BASE}\nHA_TOKEN=${token}\n`);
console.log(`Onboarded. Token written to ${out}`);
