import { type Page, expect, test } from "@playwright/test";
import { HA_TOKEN, HA_URL, haService } from "./ha";

/** Puts the mock home in one known state, so two runs show the same devices: covers closed, lights, switches and fans off, doors locked. */
async function resetHome() {
  const states = (await (await fetch(`${HA_URL}/api/states`, { headers: { authorization: `Bearer ${HA_TOKEN}` } })).json()) as { entity_id: string }[];
  for (const { entity_id } of states) {
    const d = entity_id.split(".")[0];
    if (d === "cover") await haService("cover", "close_cover", { entity_id });
    else if (["light", "switch", "fan"].includes(d)) await haService(d, "turn_off", { entity_id });
    else if (d === "lock") await haService("lock", "lock", { entity_id });
  }
  await new Promise((r) => setTimeout(r, 6000));
}
import { addVirtualPasskey } from "./passkey";

/**
 * Screenshots of every main screen at the standard text size, for comparing two builds of the front end pixel by pixel
 * (run with SHOTS=<dir>; see e2e/compare-shots.py). Not part of the normal suite. Anything that changes from run to run
 * (clock times, "synced 1s ago") is made invisible first so a difference means the layout changed.
 */
test.describe.configure({ mode: "serial" });
const OUT = process.env.SHOTS ?? "";
let page: Page;
test.skip(!OUT, "set SHOTS to take screenshots");

const settle = async (pg: Page) => {
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => {
    const re = /\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?|\bago\b|synced|\d+\s?(s|m|h) ago|Today|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun/i;
    document.querySelectorAll("body *").forEach((e) => {
      if (e.children.length === 0 && re.test(e.textContent ?? "")) (e as HTMLElement).style.color = "transparent";
    });
    document.querySelectorAll(".live i, .rec, .toast-bar").forEach((e) => ((e as HTMLElement).style.visibility = "hidden"));
  });
  await pg.waitForTimeout(200);
};
const shot = async (pg: Page, w: number, name: string) => { await settle(pg); await pg.screenshot({ path: `${OUT}/${w}-${name}.png`, fullPage: true, animations: "disabled", caret: "hide" }); };

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  await addVirtualPasskey(ctx, page);
  await resetHome();
});
test.afterAll(async () => { await page.context().close(); });

test("set up and take the screenshots", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up your home" })).toBeVisible();
  await shot(page, 390, "setup-name");
  await page.getByLabel("Your name").fill("Gokul");
  await page.getByRole("button", { name: "Create passkey and continue" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await page.getByText(/saved them somewhere safe/).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect Home Assistant" })).toBeVisible();
  await shot(page, 390, "setup-connect");
  await page.getByLabel("Address").fill(HA_URL);
  await page.getByLabel("Access token").fill(HA_TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByText(/Good (morning|afternoon|evening)|Quiet night/).first().waitFor({ timeout: 40_000 });

  for (const w of [390, 1280]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 800 });
    for (const [name, path] of [["home", "/"], ["rooms", "/rooms"], ["automate", "/automate"], ["admin", "/admin"], ["library", "/library"]] as const) {
      await page.goto(path);
      await shot(page, w, name);
    }
    await page.goto("/automate");
    for (const tab of ["Scene", "Routine"]) { const t = page.locator(".tabs .tab", { hasText: tab }); if (await t.count()) await t.first().click(); await page.waitForTimeout(500); await shot(page, w, `automate-${tab.toLowerCase()}`); }
    await page.goto("/rooms");
    const chips = page.locator(".scroller button");
    if (await chips.count() > 3) { await chips.nth(2).click(); await page.waitForTimeout(900); await shot(page, w, "rooms-room"); }
  }
  // what a person sees on a phone: the viewport (not the whole page), scrolled over content, with a sheet and a toast, light and dark
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await settle(page);
    await page.mouse.wheel(0, 520);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/view-${scheme}-home-min.png`, animations: "disabled" });
    await page.mouse.wheel(0, -80);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/view-${scheme}-home-scrolled.png`, animations: "disabled" });
    await page.goto("/rooms");
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/view-${scheme}-rooms-scrolled.png`, animations: "disabled" });
    await page.locator('[aria-label^="More controls for"]').first().click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/view-${scheme}-sheet.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.locator(".dt:visible").first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/view-${scheme}-toast.png`, animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => fetch("/api/v1/auth/logout", { method: "POST", headers: { "x-requested-with": "alice" } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await shot(page, 390, "signin");
});
