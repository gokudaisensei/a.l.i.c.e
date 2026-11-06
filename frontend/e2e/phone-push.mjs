/** Turns push on from the phone's Chrome (debug port) and asks the server to send a test notification. */
import { chromium } from "@playwright/test";
const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
await ctx.addInitScript({ path: new URL("../dev/virtual-passkey.js", import.meta.url).pathname });
const page = await ctx.newPage();
await page.goto("http://localhost:3001/?r=" + Date.now(), { waitUntil: "domcontentloaded" });
await page.getByText(/Good (morning|afternoon|evening)|Quiet night/).first().waitFor({ timeout: 30000 });
await page.getByRole("button", { name: /account/ }).click();
const sw = page.locator("[data-slot=popover]").getByRole("switch", { name: "Push notifications" });
await sw.waitFor({ timeout: 10000 });
const devices = () => page.evaluate(async () => (await (await fetch("/api/v1/users/me/push-subscriptions")).json()).devices.length);
if (await sw.isChecked()) { await sw.click(); await page.waitForTimeout(1500); }
console.log("devices before:", await devices(), "permission:", await page.evaluate(() => Notification.permission));
console.log("popover open; waiting for a real tap on the switch…");
const end = Date.now() + 90000;
while (Date.now() < end && (await devices()) === 0) await page.waitForTimeout(1000);
console.log("devices after:", await devices(), "permission:", await page.evaluate(() => Notification.permission));
await page.screenshot({ path: "/tmp/phone-push1.png" });
const r = await page.evaluate(async () => { const x = await fetch("/api/v1/users/me/push-subscriptions/test", { method: "POST", headers: { "x-requested-with": "alice" } }); return [x.status, await x.json()]; });
console.log("test push:", JSON.stringify(r));
await page.waitForTimeout(3000);
await browser.close();
