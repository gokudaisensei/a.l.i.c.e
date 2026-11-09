/**
 * Text size on a real phone: Chrome on an Android phone (USB debugging) is driven over its debug port while the page's root
 * text size is stepped through several levels at the phone's own width (a CDP width override was tried for a narrower phone;
 * on Android Chrome it left the layout wider than the screen and gave unreliable pictures, so it is not used).
 * The phone's system font size is NOT used: Android Chrome does not pass it to a page's rem (the root stayed 16 px at every
 * system level when this was tried), and changing a person's phone settings for a test is not worth it. What is real here is
 * the phone's Chrome engine, fonts, pixel density and touch.
 * Android Chrome has no virtual authenticator, so the passkey is the software one in dev/virtual-passkey.js.
 * Needs the isolated stack (node dev/phone-stack.mjs) and, with the phone on USB:
 *   adb reverse tcp:3020 tcp:3020; adb reverse tcp:3022 tcp:3022; adb forward tcp:9333 localabstract:chrome_devtools_remote
 * Run: node e2e/phone-tiers.mjs [out-dir].
 */
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fitProblems } from "./fit.mjs";
import { seedRich } from "./rich.mjs";

const out = process.argv[2] ?? "/tmp/phone-tiers";
mkdirSync(out, { recursive: true });
const adb = (c) => execSync(`adb shell ${c}`, { encoding: "utf8" }).trim();
const env = Object.fromEntries(readFileSync(new URL("../../backend/.env.test", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const wake = () => { try { adb("input keyevent KEYCODE_WAKEUP"); } catch {} };
const keepAwake = setInterval(wake, 25_000);
const problems = [];
const base = "http://localhost:3020";

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
await ctx.addInitScript({ path: new URL("../dev/virtual-passkey.js", import.meta.url).pathname });
let page = ctx.pages().find((p) => p.url().startsWith(base)) ?? (await ctx.newPage());
page.on("pageerror", (e) => console.log("page error:", e.message));
const root = () => page.evaluate(() => ({ px: parseFloat(getComputedStyle(document.documentElement).fontSize), tier: document.documentElement.dataset.text, w: innerWidth, dpr: devicePixelRatio, ua: navigator.userAgent.slice(0, 60) }));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

try {
  wake();
  await page.bringToFront();
  await page.goto(`${base}/?r=${Date.now()}`, { waitUntil: "domcontentloaded" });
  console.log("start:", JSON.stringify(await root()));

  // first run on this phone: set up the household with the software passkey, connect the mock Home Assistant
  const home = page.getByText(/Good (morning|afternoon|evening)|Quiet night/).first();
  const setup = page.getByRole("heading", { name: "Set up your home" });
  await Promise.race([setup.waitFor({ timeout: 30_000 }), home.waitFor({ timeout: 30_000 })]);
  const fresh = await setup.isVisible();
  if (fresh) {
  await page.getByLabel("Your name").fill("Phone tester");
  await page.getByRole("button", { name: "Create passkey and continue" }).click();
  await page.getByRole("heading", { name: "Save your recovery codes" }).waitFor({ timeout: 20_000 });
  await page.getByText(/saved them somewhere safe/).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Connect Home Assistant" }).waitFor();
  await page.getByLabel("Address").fill(env.HA_URL);
  await page.getByLabel("Access token").fill(env.HA_TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await home.waitFor({ timeout: 45_000 });
  console.log("set up and signed in");
  await page.waitForTimeout(1500);
  console.log("rich data:", JSON.stringify(await seedRich(page, { url: env.HA_URL, token: env.HA_TOKEN })));
  } else console.log("already set up on this stack; using it as it is");

  const textAt = (scale) => page.evaluate((sc) => { document.documentElement.style.setProperty("font-size", `${16 * sc}px`, "important"); window.dispatchEvent(new Event("resize")); }, scale);
  for (const width of [null]) {
    for (const scale of [1.0, 1.3, 1.75, 2.0, 3.0]) {
      wake();
      const label = `${width ?? "native"}-x${scale}`;
      const go = async (path, wait = 2000) => { await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(wait); await textAt(scale); await page.waitForTimeout(500); };
      for (const [name, path] of [["home", "/"], ["rooms", "/rooms"], ["automate", "/automate"], ["admin", "/admin"]]) {
        await go(path);
        const r = await root();
        await shot(`${name}-${label}`);
        problems.push(...(await fitProblems(page, `${name} @${label} (w ${r.w}, root ${r.px}px, ${r.tier})`)));
      }
      await go("/rooms");
      try { await page.locator('[aria-label^="More controls for"]').first().click({ timeout: 6000 }); }
      catch (e) { problems.push(`sheet @${label}: could not open the first tile's controls: ${String(e.message).split("\n").find((l) => /intercepts/.test(l))?.trim() ?? String(e.message).split("\n")[0]}`); await shot(`sheet-blocked-${label}`); }
      await page.waitForTimeout(1000);
      await shot(`sheet-${label}`);
      problems.push(...(await fitProblems(page, `sheet @${label}`)));
      await page.keyboard.press("Escape").catch(() => {});
      await go("/rooms");
      await page.locator(".dt:visible").first().click({ timeout: 6000 }).catch((e) => problems.push(`toast @${label}: could not press the first tile: ${String(e.message).split("\n")[0]}`));
      await page.waitForTimeout(700);
      await shot(`toast-${label}`);
      problems.push(...(await fitProblems(page, `toast @${label}`)));
      console.log(`${label}: root`, JSON.stringify(await root()));
    }
  }
} finally {
  clearInterval(keepAwake);
  await browser.close().catch(() => {});
}
console.log(problems.length ? "\nPROBLEMS:\n" + problems.join("\n") : "\nno problems on the phone");
process.exit(problems.length ? 1 : 0);
