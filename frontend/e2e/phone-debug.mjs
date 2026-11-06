/**
 * Drives the real Chrome on an Android phone (USB debugging) through its debug port. Android Chrome has no virtual
 * authenticator in its debug protocol, so the passkey is the software one in dev/virtual-passkey.js (the app's real
 * WebAuthn code runs against it); the phone's real credential store is not involved.
 * Needs: adb forward tcp:9333 localabstract:chrome_devtools_remote, adb reverse for the app and backend ports, and an
 * invitation code in INVITE. Run: INVITE=... node e2e/phone-debug.mjs
 */
import { chromium } from "@playwright/test";

const invite = process.env.INVITE;
const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
await ctx.addInitScript({ path: new URL("../dev/virtual-passkey.js", import.meta.url).pathname });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `/tmp/phone-cdp-${n}.png` });
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.goto("http://localhost:3001/?r=" + Date.now(), { waitUntil: "domcontentloaded" });
console.log("ua:", (await page.evaluate(() => navigator.userAgent)).slice(0, 90));
console.log("secure context:", await page.evaluate(() => window.isSecureContext), " touch points:", await page.evaluate(() => navigator.maxTouchPoints));

const home = page.getByText(/Good (morning|afternoon|evening)|Quiet night/).first();
const welcome = page.getByRole("heading", { name: "Welcome back" });
await Promise.race([home.waitFor({ timeout: 25000 }), welcome.waitFor({ timeout: 25000 })]).catch(() => {});
if (!(await home.isVisible())) {
  await page.getByRole("button", { name: "I have an invitation" }).click();
  await page.getByLabel("Invitation").fill(invite);
  await page.getByLabel("Your name").fill("Phone " + Math.floor(Math.random() * 90 + 10));
  await page.getByRole("button", { name: "Create passkey and join" }).click();
  await page.getByRole("heading", { name: "Save your recovery codes" }).waitFor({ timeout: 20000 });
  await page.getByText(/saved them somewhere safe/).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await home.waitFor({ timeout: 30000 });
} else console.log("signed in on this phone");
console.log("1 home loaded:", (await home.textContent())?.trim());
await shot(1);

// A light from Rooms by tapping its tile, with undo. Home Assistant is asked directly what really happened.
const env = Object.fromEntries((await import("node:fs")).readFileSync(new URL("../../backend/.env.test", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const ha = async () => ((await (await fetch(`${env.HA_URL}/api/states/light.office_rgbw_lights`, { headers: { authorization: `Bearer ${env.HA_TOKEN}` } })).json()).state);
const until = async (want, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await ha()) === want) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
await page.getByRole("link", { name: "Rooms" }).click();
await page.waitForURL("**/rooms");
const tile = page.locator(".dt:visible", { hasText: /Arjun.s lamp/ }).first();
await tile.waitFor({ timeout: 20000 });
const start = await ha(), flipped = start === "on" ? "off" : "on";
await tile.click();
console.log(`2 tapped the tile: Home Assistant went ${start} to ${flipped}:`, await until(flipped));
await shot(2);
await page.getByRole("button", { name: "Undo" }).click();
console.log("3 undo put it back:", await until(start));

// Ask Alice by typing.
await page.getByRole("button", { name: /Ask Alice/ }).first().click();
await page.keyboard.type(`turn ${flipped} arjun's lamp`);
await page.getByText(new RegExp(`Turn ${flipped} Arjun.s lamp`)).first().waitFor({ timeout: 10000 });
await shot(3);
await page.keyboard.press("Enter");
console.log("4 Ask Alice ran it:", await until(flipped));
await page.waitForTimeout(500);

// The phone's own way to sign out, then back in with the passkey made here.
await page.getByRole("button", { name: /account/ }).click();
await page.getByRole("button", { name: "Sign out" }).click();
await welcome.waitFor({ timeout: 10000 });
await page.getByRole("button", { name: "Sign in with passkey" }).click();
await page.getByRole("heading", { name: "Rooms" }).waitFor({ timeout: 20000 }).catch(async () => { await shot("fail"); console.log("sign-in did not finish; page says:", (await page.locator("[role=alert]").allTextContents()).join(" | ") || (await page.locator("main").innerText()).slice(0, 200)); throw new Error("sign-in failed"); });
console.log("5 signed out and back in with the passkey");
await shot(4);
await browser.close();
