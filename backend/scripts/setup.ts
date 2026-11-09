/**
 * One-time setup for Alice: installs deps, writes env files + keys, and sets up Home Assistant (a disposable test
 * instance in Docker, or one you already run). Run it with ./setup.sh (which only makes sure Bun exists), then ./run.sh.
 * Re-running is safe: existing env files and a working test HA are kept unless you pass --force.
 *
 * For an existing HA you do not need the web UI: give your HA username and password and setup signs in through HA's
 * login API and mints a long-lived token itself (the password is used once and never stored). Pasting a token still
 * works, and you can skip HA entirely and connect it later in the app.
 */
import * as p from "@clack/prompts";
import { connect } from "node:net";
import { existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const BACKEND = join(ROOT, "backend");
const STATE = join(ROOT, ".env.alice");

const USAGE = `Usage: ./setup.sh [options]
  -y, --yes, --non-interactive   Never prompt; use flags/defaults (fails instead of asking)
      --frontend-port N          Web app port            (default 3000)
      --backend-port N           API + websocket port    (default 3001)
      --ha-port N                Test Home Assistant port (default 8123)
      --host NAME                Hostname you open the app at (default localhost; sets passkey origin)
      --ha MODE                  mock (Docker test HA) | existing | none   (default: mock if Docker works)
      --ha-url URL               Existing HA address, e.g. http://192.168.1.10:8123 (implies --ha existing)
      --ha-token TOKEN           Existing HA long-lived token (or env HA_TOKEN)
      --ha-user NAME             Existing HA login; with --ha-password (or env HA_PASSWORD) setup mints the token itself
      --ha-password PASSWORD
      --seed | --no-seed         Fill the test HA with a furnished home (default: seed)
      --install-bun              (handled by setup.sh) Install Bun automatically if missing
      --skip-install             Skip \`bun install\`
      --force                    Regenerate env files/keys and recreate the test HA
      --start                    Run ./run.sh when setup finishes
  -h, --help`;

// ---------- output helpers ----------
const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const [bold, red, green, yellow] = [c("1"), c("31"), c("32"), c("33")];
const info = (m: string) => console.log(`${bold("==>")} ${m}`);
const ok = (m: string) => console.log(`${green("✓")} ${m}`);
const warn = (m: string) => console.error(`${yellow("!")} ${m}`);
const die = (m: string): never => { console.error(red(`✗ ${m}`)); process.exit(1); };

// ---------- options ----------
const opt = {
  interactive: !!process.stdin.isTTY, feport: "", beport: "", haport: "", host: "", ha: "", haUrl: "",
  haToken: process.env.HA_TOKEN ?? "", haUser: "", haPassword: process.env.HA_PASSWORD ?? "",
  seed: true, skipInstall: false, force: false, start: false,
};
{
  const a = process.argv.slice(2);
  const val = (i: number) => a[i + 1] ?? die(`${a[i]} needs a value`);
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "-y": case "--yes": case "--non-interactive": opt.interactive = false; break;
      case "--frontend-port": opt.feport = val(i++); break;
      case "--backend-port": opt.beport = val(i++); break;
      case "--ha-port": opt.haport = val(i++); break;
      case "--host": opt.host = val(i++); break;
      case "--ha": opt.ha = val(i++); break;
      case "--ha-url": opt.haUrl = val(i++).replace(/\/$/, ""); opt.ha ||= "existing"; break;
      case "--ha-token": opt.haToken = val(i++); break;
      case "--ha-user": opt.haUser = val(i++); break;
      case "--ha-password": opt.haPassword = val(i++); break;
      case "--seed": opt.seed = true; break;
      case "--no-seed": opt.seed = false; break;
      case "--install-bun": break;
      case "--skip-install": opt.skipInstall = true; break;
      case "--force": opt.force = true; break;
      case "--start": opt.start = true; break;
      case "-h": case "--help": console.log(USAGE); process.exit(0);
      default: console.error(USAGE); die(`Unknown option: ${a[i]}`);
    }
  }
  if (!["", "mock", "existing", "none"].includes(opt.ha)) die("--ha must be mock, existing or none");
}

// ---------- prompts (@clack/prompts; only used when interactive) ----------
const answer = <T>(v: T | symbol): T => { if (p.isCancel(v)) { p.cancel("Setup cancelled."); process.exit(130); } return v as T; };
const ask = async (q: string, def: string) => answer<string>(await p.text({ message: q, placeholder: def, defaultValue: def })).trim();
const confirm = async (q: string, def: boolean) => (opt.interactive ? answer(await p.confirm({ message: q, initialValue: def })) : def);
const secret = async (q: string) => answer<string>(await p.password({ message: q, validate: (v) => (v ? undefined : "Required") }));
const choose = async <T extends string>(q: string, options: { value: T; label: string; hint?: string }[], initial: T) =>
  answer(await p.select({ message: q, options: options as any, initialValue: initial })) as T;

// ---------- small utilities ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry<T>(n: number, what: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= n) throw e;
      warn(`${what}: attempt ${i}/${n} failed (${(e as Error).message}), retrying in 5s`); await sleep(5000);
    }
  }
}
/** Runs a command; output goes to the terminal unless quiet. Returns the exit code and captured stdout. */
function run(cmd: string[], o: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}) {
  const p = Bun.spawnSync(cmd, { cwd: o.cwd ?? BACKEND, env: { ...process.env, ...o.env }, stdout: "pipe", stderr: o.quiet ? "pipe" : "inherit" });
  return { code: p.exitCode, out: p.stdout.toString() };
}
const portBusy = (port: number) => new Promise<boolean>((res) => {
  const s = connect(port, "127.0.0.1");
  s.once("connect", () => { s.destroy(); res(true); });
  s.once("error", () => res(false));
});
const validPort = (p: string) => /^\d+$/.test(p) && +p >= 1024 && +p <= 65535;
const readEnv = (file: string) => Object.fromEntries(
  (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2]]));
const envGet = (file: string, key: string) => readEnv(file)[key] ?? "";
const stamp = () => Math.floor(Date.now() / 1000);

let reusePort = "";
/** A busy default moves to the next free port; a busy port you asked for is an error (non-interactive) or a re-prompt. */
async function choosePort(name: string, def: number, given: string): Promise<string> {
  let port = given || String(def);
  let asked = !!given;
  for (;;) {
    if (opt.interactive && !asked) port = await ask(`${name} port`, port);
    if (!validPort(port)) {
      if (!opt.interactive) die(`${name} port '${port}' is not a valid port (1024-65535)`);
      warn(`'${port}' is not a valid port`); asked = false; port = String(def); continue;
    }
    if ((await portBusy(+port)) && reusePort !== port) {
      if (opt.interactive) { warn(`port ${port} is in use`); asked = false; port = String(+port + 1); continue; }
      if (given) die(`${name} port ${port} is already in use`);
      let q = +port; while (await portBusy(q)) q++;
      warn(`${name} port ${port} is in use, using ${q}`); port = String(q);
    }
    return port;
  }
}

// ---------- Home Assistant API ----------
async function haFetch(url: string, init?: RequestInit) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }); } catch { return null; }
}
const haReachable = async (url: string) => !!(await haFetch(`${url}/api/onboarding`) ?? await haFetch(`${url}/`));
async function haTokenOk(url: string, token: string) {
  return !!token && (await haFetch(`${url}/api/`, { headers: { authorization: `Bearer ${token}` } }))?.ok === true;
}
async function haPost(url: string, path: string, body: unknown) {
  const r = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
}

/**
 * Signs in to HA through its login API (the same one its own web page uses), then mints a long-lived token over the
 * websocket. This is how you connect from a terminal with no browser. Returns the token.
 */
async function mintToken(url: string, username: string, password: string): Promise<string> {
  const clientId = `${url}/`;
  const start = await haPost(url, "/auth/login_flow", { client_id: clientId, handler: ["homeassistant", null], redirect_uri: `${url}/?auth_callback=1` });
  if (!start.json.flow_id) throw new Error(`HA did not start a login (${start.status})`);
  let step = await haPost(url, `/auth/login_flow/${start.json.flow_id}`, { client_id: clientId, username, password });
  while (step.json.type === "form" && step.json.step_id === "mfa") {
    if (!opt.interactive) throw new Error("this account needs a two-factor code; run setup interactively or use a token");
    const code = await ask("Two-factor code", "");
    step = await haPost(url, `/auth/login_flow/${start.json.flow_id}`, { client_id: clientId, code });
  }
  if (step.json.type !== "create_entry") throw new Error(step.json.errors?.base === "invalid_auth" ? "wrong username or password" : `login failed (${step.json.type ?? step.status})`);
  const tok = await fetch(`${url}/auth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: step.json.result, client_id: clientId }) });
  if (!tok.ok) throw new Error(`token exchange failed (${tok.status})`);
  const access = ((await tok.json()) as { access_token: string }).access_token;
  return new Promise<string>((resolveTok, reject) => {
    const ws = new WebSocket(`${url.replace(/^http/, "ws")}/api/websocket`);
    const timer = setTimeout(() => { ws.close(); reject(new Error("timed out minting the token")); }, 15_000);
    const end = (f: () => void) => { clearTimeout(timer); ws.close(); f(); };
    ws.onerror = () => end(() => reject(new Error("websocket error")));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: access }));
      else if (m.type === "auth_ok") ws.send(JSON.stringify({ id: 1, type: "auth/long_lived_access_token", client_name: "alice", lifespan: 3650 }));
      else if (m.type === "auth_invalid") end(() => reject(new Error("auth_invalid")));
      else if (m.type === "result" && m.id === 1) end(() => (m.success ? resolveTok(m.result) : reject(new Error(JSON.stringify(m.error)))));
    };
  });
}

// ---------- 1. prerequisites ----------
info("Checking tools");
ok(`bun ${Bun.version}`);
Bun.which("node") ? ok(`node ${run(["node", "--version"], { quiet: true }).out.trim()}`) : warn("node not found; Next.js dev server may need it");
function dockerProblem(): string {
  if (!Bun.which("docker")) return "the docker command is not on PATH";
  if (run(["docker", "compose", "version"], { quiet: true }).code !== 0) return "`docker compose` (the v2 plugin) is not installed";
  const i = Bun.spawnSync(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
  if (i.exitCode === 0) return "";
  const err = i.stderr.toString().trim().split("\n").pop() ?? "";
  return /permission denied/i.test(err) ? `your user cannot reach the Docker daemon (${err}). Fix: sudo usermod -aG docker $USER, then log out and in`
    : `the Docker daemon is not reachable (${err}). Is it running? sudo systemctl start docker`;
}
const dockerWhy = dockerProblem(), dockerOk = !dockerWhy;
dockerOk ? ok("docker + compose") : warn(`Docker is not usable: ${dockerWhy}. The test Home Assistant can't be started.`);

// ---------- 2. choose Home Assistant mode ----------
if (!opt.ha) {
  const def = dockerOk ? "mock" : "none";
  if (opt.interactive) {
    opt.ha = await choose("Home Assistant", [
      { value: "mock", label: "Test instance", hint: "disposable, in Docker, set up for you" },
      { value: "existing", label: "Existing", hint: "connect to one you already run" },
      { value: "none", label: "None", hint: "connect later in the app" }], def as "mock" | "none");
  } else opt.ha = def;
}
if (opt.ha === "mock" && !dockerOk) {
  if (!opt.interactive) { warn("falling back to --ha none (no Docker)"); opt.ha = "none"; }
  else opt.ha = await choose("Docker is unavailable. Home Assistant", [{ value: "existing", label: "Existing" }, { value: "none", label: "None" }], "existing");
}

// ---------- 3. ports and host ----------
info("Choosing ports");
const host = opt.host || (opt.interactive ? await ask("Hostname you'll open the app at (use the server's address if you browse from another machine)", "localhost") : "localhost");
if (!/^[A-Za-z0-9.-]+$/.test(host)) die(`invalid host '${host}'`);
const fePort = await choosePort("Frontend", 3000, opt.feport);
const bePort = await choosePort("Backend", 3001, opt.beport);
if (fePort === bePort) die("frontend and backend ports must differ");
let haPort = "";
if (opt.ha === "mock") {
  // our own previous test HA legitimately holds the port when we re-run
  if (run(["docker", "ps", "--format", "{{.Names}}"], { quiet: true }).out.split("\n").includes("alice-ha-mock")) reusePort = opt.haport || envGet(STATE, "HA_PORT") || "8123";
  haPort = await choosePort("Test Home Assistant", 8123, opt.haport);
  if ([fePort, bePort].includes(haPort)) die("ports must all differ");
}
ok(`frontend ${fePort}, backend ${bePort}${haPort ? `, HA ${haPort}` : ""}`);

// ---------- 4. install dependencies ----------
if (!opt.skipInstall) {
  info("Installing dependencies");
  await retry(3, "bun install", async () => { if (run(["bun", "install"], { cwd: ROOT }).code !== 0) throw new Error("exit non-zero"); })
    .catch(() => die("bun install failed (network?). Fix and re-run, or use --skip-install if already installed."));
  ok("dependencies installed");
}

// ---------- 5. env files and keys ----------
info("Writing environment files");
const envFile = join(BACKEND, ".env"), workerFile = join(BACKEND, ".env.worker");
const hex = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("hex");
if (existsSync(envFile) && !opt.force && envGet(envFile, "SECRETS_KEY")) {
  warn("backend/.env exists: keeping its keys (use --force to regenerate). Ports/origins are updated.");
  // Older setups kept the worker's private key in .env; move it out so the server no longer holds it.
  if (!existsSync(workerFile)) {
    const pk = envGet(envFile, "ADMIN_SEAL_PRIVATE_KEY");
    if (!pk) die("backend/.env has no ADMIN_SEAL_PRIVATE_KEY and there is no backend/.env.worker; re-run with --force to regenerate keys (existing data tokens become unreadable).");
    copyFileSync(envFile, `${envFile}.bak.${stamp()}`);
    writeFileSync(workerFile, `ADMIN_SEAL_PRIVATE_KEY=${pk}\n`); chmodSync(workerFile, 0o600);
    writeFileSync(envFile, readFileSync(envFile, "utf8").split("\n").filter((l) => !/^#? ?ADMIN_SEAL_PRIVATE_KEY=/.test(l)).join("\n"));
  }
} else {
  if (existsSync(envFile)) { copyFileSync(envFile, `${envFile}.bak.${stamp()}`); warn("backed up old backend/.env"); }
  const gen = run(["bun", "run", "keys:generate"], { quiet: true });
  if (gen.code !== 0) die(`key generation failed:\n${gen.out}`);
  const keys = Object.fromEntries(gen.out.split("\n").map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2]]));
  for (const v of ["SECRETS_KEY", "ADMIN_SEAL_PUBLIC_KEY", "ADMIN_SEAL_PRIVATE_KEY", "BACKUP_ENCRYPTION_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) {
    if (!keys[v]) die(`keys:generate did not print ${v}`);
  }
  writeFileSync(envFile, [
    "NODE_ENV=development", "LOG_LEVEL=info", "DATABASE_URL=./data/alice.db", "WEBAUTHN_RP_NAME=Alice", "SESSION_TTL_HOURS=720",
    "TRUST_PROXY=false", `SETUP_CODE=${hex(6)}`,
    ...["SECRETS_KEY", "ADMIN_SEAL_PUBLIC_KEY", "BACKUP_ENCRYPTION_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].map((v) => `${v}=${keys[v]}`),
    "VAPID_SUBJECT=mailto:admin@localhost", "",
  ].join("\n"));
  // The private half goes only to the worker (the point of the server/worker split).
  writeFileSync(workerFile, `ADMIN_SEAL_PRIVATE_KEY=${keys.ADMIN_SEAL_PRIVATE_KEY}\n`);
  chmodSync(envFile, 0o600); chmodSync(workerFile, 0o600);
  ok("generated keys and setup code");
}
// Ports and origins are rewritten on every run so re-running with new ports works.
let env = readFileSync(envFile, "utf8").split("\n").filter((l) => !/^(PORT|CORS_ORIGINS|WEBAUTHN_RP_ID|WEBAUTHN_ORIGIN)=/.test(l)).join("\n").replace(/\n*$/, "\n");
env += `PORT=${bePort}\nCORS_ORIGINS=http://${host}:${fePort}\nWEBAUTHN_RP_ID=${host}\nWEBAUTHN_ORIGIN=http://${host}:${fePort}\n`;
// A hand-edited .env may lack a setup code; the first sign-up needs one outside production.
if (!/^SETUP_CODE=.+/m.test(env)) env += `SETUP_CODE=${hex(6)}\n`;
writeFileSync(envFile, env);
mkdirSync(join(BACKEND, "data"), { recursive: true });
writeFileSync(join(ROOT, "frontend/.env.local"), `BACKEND_URL=http://localhost:${bePort}\nNEXT_PUBLIC_WS_URL=ws://localhost:${bePort}/ws\n`);
ok("backend/.env, backend/.env.worker, frontend/.env.local");

// ---------- 6. Home Assistant ----------
let haUrl = "", haTokenOut = "";
const testEnv = join(BACKEND, ".env.test");
if (opt.ha === "mock") {
  info("Starting the test Home Assistant (first run pulls a large image; this can take a few minutes)");
  haUrl = `http://127.0.0.1:${haPort}`;
  const haEnv = { HA_PORT: haPort };
  if (opt.force) { run(["bun", "run", "ha:down"], { env: haEnv, quiet: true }); Bun.spawnSync(["rm", "-f", testEnv]); }
  await retry(3, "ha:up", async () => { if (run(["bun", "run", "ha:up"], { env: haEnv }).code !== 0) throw new Error("exit non-zero"); })
    .catch(() => die("could not start the test HA container. Check 'docker compose' output above, or re-run with --ha none / --ha existing."));
  if (existsSync(testEnv) && (await haTokenOk(haUrl, envGet(testEnv, "HA_TOKEN")))) ok("test HA already onboarded, reusing its token");
  else {
    Bun.spawnSync(["rm", "-f", testEnv]);
    // bootstrap waits up to 3 minutes for HA itself; retry covers slow first boots
    await retry(2, "ha:bootstrap", async () => { if (run(["bun", "run", "ha:bootstrap"], { env: { HA_URL: haUrl } }).code !== 0) throw new Error("exit non-zero"); })
      .catch(() => die("could not onboard the test HA. If it was onboarded earlier without a saved token, reset it: (cd backend && bun run ha:down) then re-run ./setup.sh"));
  }
  haTokenOut = envGet(testEnv, "HA_TOKEN");
  if (opt.seed) {
    await retry(2, "ha:seed", async () => { if (run(["bun", "run", "ha:seed"], { env: { HA_URL: haUrl, HA_TOKEN: haTokenOut } }).code !== 0) throw new Error("exit non-zero"); })
      .then(() => ok("seeded the test home"))
      .catch(() => warn("seeding failed; Alice still works, rooms/devices just won't be pre-arranged (retry: cd backend && bun run ha:seed)"));
  }
} else if (opt.ha === "existing") {
  let url = opt.haUrl, token = opt.haToken, user = opt.haUser, pass = opt.haPassword;
  for (;;) {
    if (!url) { if (!opt.interactive) die("--ha existing needs --ha-url"); url = await ask("Home Assistant address", "http://homeassistant.local:8123"); }
    url = url.replace(/\/$/, ""); if (!/^https?:\/\//.test(url)) url = `http://${url}`;
    let problem = "";
    if (!(await haReachable(url))) problem = `cannot reach ${url}`;
    else {
      if (!token && !(user && pass)) {
        if (!opt.interactive) die("--ha existing needs --ha-token, or --ha-user with --ha-password (or env HA_TOKEN / HA_PASSWORD)");
        const how = await choose("How should Alice connect to Home Assistant? (no web browser needed)", [
          { value: "login", label: "Sign in here", hint: "username + password; setup creates the token, the password is not stored" },
          { value: "token", label: "Paste a token", hint: "a long-lived token you already have" },
          { value: "skip", label: "Skip", hint: "connect later in the app" }], "login");
        if (how === "skip") { warn("continuing without Home Assistant; connect it later in the app"); break; }
        if (how === "token") token = await secret("Long-lived token");
        else { user = await ask("HA username", "admin"); pass = await secret("HA password"); }
      }
      if (!token) {
        try { token = await mintToken(url, user, pass); ok(`signed in as ${user} and created a long-lived token`); }
        catch (e) { problem = `could not sign in: ${(e as Error).message}`; }
      }
      if (!problem && !(await haTokenOk(url, token))) problem = `${url} is reachable but rejected the token`;
    }
    if (!problem) { haUrl = url; haTokenOut = token; ok(`connected to ${url}`); break; }
    warn(problem);
    if (opt.interactive && (await confirm("Try again?", true))) { token = user = pass = ""; if (problem.startsWith("cannot reach")) url = ""; continue; }
    if (opt.interactive) { warn("continuing without a verified Home Assistant; connect it later in the app"); break; }
    die("Home Assistant check failed (see above)");
  }
} else warn("no Home Assistant configured; connect one in the app later (Alice runs without it)");

// ---------- 7. save state for run.sh ----------
writeFileSync(STATE, [`FE_PORT=${fePort}`, `BE_PORT=${bePort}`, `HOST=${host}`, `HA_MODE=${opt.ha}`,
  ...(opt.ha === "mock" ? [`HA_PORT=${haPort}`] : []), ...(haUrl ? [`HA_URL=${haUrl}`] : []), ""].join("\n"));
chmodSync(STATE, 0o600);

console.log(`
${green(bold("Setup complete."))}
  Start it:        ./run.sh
  Open:            http://${host}:${fePort}
  First sign-up:   setup code  ${envGet(envFile, "SETUP_CODE")}   (you become the household admin)`);
if (haUrl) {
  console.log("  Then connect Home Assistant in the app with:");
  console.log(`    address  ${haUrl.replace("127.0.0.1", "localhost")}`);
  if (haTokenOut) console.log(`    token    ${haTokenOut}${opt.ha === "mock" ? "   (also in backend/.env.test for the test HA)" : ""}`);
  if (opt.ha === "mock") console.log("    HA login admin / alice-test-only (the test instance only)");
}
console.log();
if (opt.start) { const p = Bun.spawn([join(ROOT, "run.sh")], { stdio: ["inherit", "inherit", "inherit"] }); process.exit(await p.exited); }
