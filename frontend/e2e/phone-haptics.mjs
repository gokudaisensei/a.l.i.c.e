/**
 * Haptics and gestures on a real Android phone. Chrome on the phone (USB debugging) is driven over its debug port with real
 * touch input; Android logs every vibration it plays (dumpsys vibrator_manager: who asked, and the waveform it played), so after
 * each gesture this reads that log and compares it with the calls the page made. What it cannot say is how it FEELS.
 * Needs the isolated stack (node dev/phone-stack.mjs) and: adb reverse tcp:3020 tcp:3020; adb reverse tcp:3022 tcp:3022;
 * adb forward tcp:9333 localabstract:chrome_devtools_remote. Run: node e2e/phone-haptics.mjs
 */
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";

const base = "http://localhost:3020/library/preview";
const sh = (c) => execSync(`adb shell ${c}`, { encoding: "utf8", maxBuffer: 20_000_000 });
const wake = setInterval(() => { try { sh("input keyevent KEYCODE_WAKEUP"); } catch {} }, 20_000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Vibrations Android logged for Chrome since `afterMs` (device clock, as a number), with the waveform it played. */
function chromeVibrations() {
  const dump = sh("dumpsys vibrator_manager");
  const out = [];
  for (const line of dump.split("\n")) {
    if (!/com\.android\.chrome/.test(line) || !/\| played:/.test(line)) continue;
    const stamp = line.match(/(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d\d\d)/);
    if (!stamp) continue;
    const played = (line.match(/played: (\[.*?\])(?: \||$)/) ?? [])[1] ?? "";
    const steps = [...played.matchAll(/Step=(\d+)ms\(amplitude=([\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const status = (line.match(/\|\s*effect\s*\|\s*(\w+)/) ?? [])[1] ?? "?";
    out.push({ at: stamp.slice(3, 7).join(":"), ms: line.match(/duration:\s*(\d+)ms/)?.[1], status, steps, raw: line });
  }
  return out;
}

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
await ctx.addInitScript(() => {
  window.__calls = [];
  const real = navigator.vibrate.bind(navigator);
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: (p) => { window.__calls.push(p); return real(p); } });
});
const page = ctx.pages().find((p) => p.url().includes("3020")) ?? (await ctx.newPage());
page.on("pageerror", (e) => console.log("page error:", e.message));
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const tap = async (x, y) => { await touch("touchStart", [[x, y]]); await wait(60); await touch("touchEnd", []); };
const drag = async (a, b, steps = 14, hold = 0) => {
  await touch("touchStart", [a]); if (hold) await wait(hold);
  for (let i = 1; i <= steps; i++) { await touch("touchMove", [[a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]]); await wait(16); }
  await wait(40); await touch("touchEnd", []);
};
const box = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
const go = async (at) => { await page.goto(`${base}/${at}`, { waitUntil: "domcontentloaded" }); await page.locator(".lib-host").waitFor({ timeout: 20_000 }); await wait(700); };

const results = [];
async function scenario(name, at, act, { onLoad = false } = {}) {
  const before = new Set(chromeVibrations().map((v) => v.raw)); // everything Android already logged for Chrome
  await go(at);
  if (!onLoad) await page.evaluate(() => { window.__calls = []; }); // keep what the page asked for while loading, if that is the point
  await act();
  await wait(1100);
  const calls = await page.evaluate(() => window.__calls);
  const played = chromeVibrations().filter((v) => !before.has(v.raw)); // what the vibrator actually played because of this gesture
  results.push({ name, calls, played, ok: calls.length === played.length });
  console.log(`\n${name}\n  page asked for ${calls.length}: ${JSON.stringify(calls).slice(0, 150)}\n  Android played ${played.length}: ${played.map((v) => `${v.ms}ms`).join(", ").slice(0, 150)}`);
}

try {
  console.log("device:", sh("getprop ro.product.model").trim(), "| vibrate on:", /vibrateOn = true/.test(sh("dumpsys vibrator_manager")));
  await go("switch/basic");
  console.log("viewport:", await page.evaluate(() => `${innerWidth}x${innerHeight} @${devicePixelRatio}x, vibrate ${typeof navigator.vibrate}`));

  await scenario("switch: two taps (off, then on)", "switch/basic", async () => { const c = await box('[role="switch"]'); await tap(c.x, c.y); await wait(500); await tap(c.x, c.y); });
  await scenario("switch: drag the thumb across (finger)", "switch/basic", async () => { const c = await box('[role="switch"]'); await drag([c.b.x + c.b.width - 12, c.y], [c.b.x + 4, c.y]); });
  await scenario("segmented: swipe across three segments (finger)", "segmented/basic", async () => { const a = await box('[role="radio"]:nth-of-type(1)'), z = await box('[role="radio"]:nth-of-type(3)'); await drag([a.x, a.y], [z.x, z.y]); });
  await scenario("tabs: swipe across (finger)", "tabs/basic", async () => { const a = await box('[role="tab"]:nth-of-type(1)'), z = await box('[role="tab"]:nth-of-type(3)'); await drag([a.x, a.y], [z.x, z.y]); });
  await scenario("stepper: scrub the number", "stepper/basic", async () => { const o = await box("output"); await drag([o.x, o.y], [o.x + 70, o.y], 14); });
  await scenario("slider: drag across the quarters", "slider/basic", async () => { const c = await box(".rng-c"); await drag([c.b.x + 6, c.y], [c.b.x + c.b.width - 6, c.y], 24); });
  await scenario("blind: pull past the end", "cover-shade/basic", async () => { const c = await box('[data-slot="cover-shade"]'); await drag([c.x, c.y], [c.x, c.b.y + c.b.height + 110], 16); });
  await scenario("device tile: hold", "device-tile/lamp", async () => { const c = await box(".dt"); await touch("touchStart", [[c.x, c.y]]); await wait(900); await touch("touchEnd", []); });
  await scenario("colour wheel: double-tap", "color-controls/wheel", async () => { const c = await box('[data-slot="color-wheel"]'); await tap(c.x + 30, c.y - 20); await wait(120); await tap(c.x + 30, c.y - 20); });
  await scenario("toast: a plain note is silent", "toast/with-undo", async () => { const c = await box("button"); await tap(c.x, c.y); });
  await scenario("toast: swipe it away (finger)", "toast/with-undo", async () => { const c = await box("button"); await tap(c.x, c.y); await wait(700); const t = await box(".toast-t"); await drag([t.x, t.y], [t.x + 230, t.y], 12); });
  await scenario("toasts shown on load, before any touch: warning and success", "toast/tones", async () => {}, { onLoad: true });
} finally {
  clearInterval(wake);
  await browser.close().catch(() => {});
}
console.log("\nsummary:");
for (const r of results) console.log(`  ${r.ok ? "ok  " : "NONE"} ${r.name}: page ${r.calls.length}, Android ${r.played.length}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
