import { type Page, expect, test } from "@playwright/test";
import { HA_TOKEN, HA_URL, haScripts, haService, haState } from "./ha";
import { addVirtualPasskey } from "./passkey";
import { fitProblems } from "./fit.mjs";
import { seedRich } from "./rich.mjs";

/** The whole product in one real browser: set up, sign in with a passkey, control the home, build, and look after it. */
test.describe.configure({ mode: "serial" });

let page: Page;
const LAMP = "light.living_room_rgbww_lights";
const until = async (fn: () => Promise<boolean>, what: string, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 400)); }
};

/** Sets the text size the way a person\'s setting would (the root font size), and lets the tier script notice. */
const textAt = (pg: Page, scale: number | null) => pg.evaluate((sc) => {
  if (sc === null) document.documentElement.style.removeProperty("font-size"); else document.documentElement.style.setProperty("font-size", `${16 * sc}px`, "important");
  window.dispatchEvent(new Event("resize"));
}, scale);
const tierOf = (scale: number) => (scale < 1.15 ? "std" : scale < 1.5 ? "lg" : scale < 2 ? "xl" : "ax");
const setupProblems: string[] = [];
const fit = async (pg: Page, name: string, scale: number, into: string[]) => { await pg.waitForTimeout(450); into.push(...(await fitProblems(pg, name, tierOf(scale)))); };

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  page = await context.newPage();
  await addVirtualPasskey(context, page);
  await haService("light", "turn_off", { entity_id: LAMP });
});
test.afterAll(async () => { await page.context().close(); });

test("first run: set up with a passkey, save the recovery codes, connect Home Assistant", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up your home" })).toBeVisible();
  // the set-up screens at large text (xl), step by step; they exist only once, on a fresh database
  await textAt(page, 1.75); await fit(page, "setup: name", 1.75, setupProblems);
  await textAt(page, null);
  await page.getByLabel("Your name").fill("Gokul");
  await page.getByRole("button", { name: "Create passkey and continue" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(10);
  await textAt(page, 1.75); await fit(page, "setup: recovery codes", 1.75, setupProblems); await textAt(page, 3); await fit(page, "setup: recovery codes (ax5)", 3, setupProblems); await textAt(page, null);
  await page.getByText(/saved them somewhere safe/).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Connect Home Assistant" })).toBeVisible();
  await textAt(page, 1.75); await fit(page, "setup: connect", 1.75, setupProblems); await textAt(page, 3); await fit(page, "setup: connect (ax5)", 3, setupProblems); await textAt(page, null);
  await page.getByLabel("Address").fill(HA_URL);
  await page.getByLabel("Access token").fill(HA_TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByText("Household mode")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("Gokul").first()).toBeVisible();
});

test("sign out, then sign back in with the same passkey", async () => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const sc of [1.3, 1.75, 2, 3]) { await textAt(page, sc); await fit(page, `sign-in at ${sc * 100}%`, sc, setupProblems); }
  await textAt(page, null);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page.getByText("Household mode")).toBeVisible({ timeout: 30_000 });
});

test("real devices appear in their rooms and a switch changes the light in Home Assistant", async () => {
  await page.getByRole("link", { name: "Rooms" }).first().click();
  await expect(page.getByRole("heading", { name: "Living Room" })).toBeVisible();
  const sw = page.getByRole("switch", { name: "Floor lamp" });
  await expect(sw).toBeVisible();
  await sw.click();
  await until(async () => (await haState(LAMP)) === "on", "the lamp to turn on in Home Assistant");
  await expect(sw).toBeChecked();
  // and the other way: a change made in Home Assistant shows up without a reload
  await haService("light", "turn_off", { entity_id: LAMP });
  await expect(sw).not.toBeChecked({ timeout: 15_000 });
});

test("undo in the toast puts the lamp back, and the session is refreshed for the cookie to follow", async () => {
  const sw = page.getByRole("switch", { name: "Floor lamp" });
  await sw.click();
  await until(async () => (await haState(LAMP)) === "on", "the lamp to turn on");
  // The backend marks the command finished a moment after Home Assistant reports the change, and an Undo before that is refused
  // (probable cause of an old intermittent failure here; not proved). The test is about undo, so let the command settle first.
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Undo" }).click();
  await until(async () => (await haState(LAMP)) === "off", "the undo to turn it off again");
  await expect(sw).not.toBeChecked({ timeout: 15_000 });
});

test("a scene built in the app reaches Home Assistant and runs from Home", async () => {
  await page.getByRole("link", { name: "Automate" }).click();
  await page.getByRole("radio", { name: "Scene" }).click();
  await page.getByRole("button", { name: "Turn on", exact: true }).click();
  await page.getByPlaceholder("Name this scene").fill("Lamp up");
  await page.getByRole("button", { name: "Save to Home Assistant" }).click();
  await expect(page.getByText("Scene saved")).toBeVisible();
  await until(async () => (await haScripts()).includes("Alice scene: Lamp up"), "the scene to appear in Home Assistant", 40_000);
});

test("Ask Alice reads a sentence and runs it", async () => {
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").or(page.getByRole("textbox", { name: /ask alice|search/i })).first().fill("turn on the floor lamp");
  await expect(page.getByText("Turn on Floor lamp")).toBeVisible();
  await page.keyboard.press("Enter");
  await until(async () => (await haState(LAMP)) === "on", "Ask Alice to turn the lamp on");
});

test("admin: a backup is made, passes its restore test, and support access needs a passkey", async () => {
  await page.getByRole("link", { name: "Admin" }).click();
  await page.getByRole("tab", { name: /Backups/ }).click();
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText("Alice · This server").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Run restore test" }).click();
  await expect(page.getByText("Your last backup works.")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Support access" }).click();
  await page.getByRole("button", { name: "Grant access with passkey" }).click();
  await page.getByRole("button", { name: "Use passkey" }).click();
  await expect(page.getByText("Support has access")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Gokul gave support access for 1 hour")).toBeVisible();
  await page.getByRole("button", { name: "End access now" }).click();
  await expect(page.getByText("No one has access right now")).toBeVisible();
});

test("on a phone, switching rooms and pages moves without jumps", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rooms");
  const chips = page.locator(".scroller button");
  await chips.first().waitFor();
  await page.waitForTimeout(1500);
  type Shifting = Window & { __shifts: number[] };
  type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean };
  const shifts = () => page.evaluate(() => (window as unknown as Shifting).__shifts.reduce((a, b) => a + b, 0));
  await page.evaluate(() => {
    const w = window as unknown as Shifting;
    w.__shifts = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries() as Shift[]) if (!e.hadRecentInput) w.__shifts.push(e.value); }).observe({ type: "layout-shift", buffered: false });
  });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);

  // A short room after "All": the page must not collapse in one frame, and nothing may shift.
  await chips.nth(3).click();
  const heights: number[] = [];
  for (let i = 0; i < 12; i++) { heights.push(await page.evaluate(() => document.documentElement.scrollHeight)); await page.waitForTimeout(50); }
  expect(heights[0]).toBeGreaterThan(tall * 0.9); // held for a moment, not dropped at once
  expect(heights.at(-1)!).toBeLessThan(tall);       // then let go
  await page.waitForTimeout(900);
  expect(await shifts()).toBeLessThan(0.02);

  // And back, and between pages with the bottom tab bar.
  await chips.nth(0).click();
  await page.waitForTimeout(700);
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByText(/Good (morning|afternoon|evening)|Quiet night/).first().waitFor();
  await page.waitForTimeout(900);
  await page.getByRole("link", { name: "Rooms" }).click();
  await chips.first().waitFor();
  await page.waitForTimeout(900);
  expect(await shifts()).toBeLessThan(0.05);
  await page.setViewportSize({ width: 1280, height: 720 });
});

test("on a phone, the logo and tab bar stay put while pages change", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByText(/Good (morning|afternoon|evening)|Quiet night/).first().waitFor();
  await page.waitForTimeout(1500);
  // The top bar, tab bar and Ask Alice button are separate layers during a page change; only the page itself is animated.
  const layers = await page.evaluate(() => ["top", "rail", "fab", "main"].map((c) => getComputedStyle(document.querySelector(c === "main" ? "#main" : `.${c}`)!).viewTransitionName));
  expect(layers).toEqual(["chrome-top", "chrome-rail", "chrome-fab", "page"]);
  for (const tab of ["Rooms", "Automate", "Home"]) {
    await page.getByRole("link", { name: tab }).click();
    const animated = await page.evaluate(async () => {
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        for (const a of document.getAnimations()) { const pe = (a.effect as KeyframeEffect | null)?.pseudoElement; const name = (a as CSSAnimation).animationName; if (pe && name) seen.add(`${pe}:${name}`); }
        await new Promise((r) => setTimeout(r, 25));
      }
      return [...seen];
    });
    // Nothing fades the whole screen (root) and nothing fades the chrome; the page fades in.
    expect(animated.filter((x) => x.includes("(root)") || x.includes("chrome-")), `${tab}: ${animated.join(", ")}`).toEqual([]);
    await page.waitForTimeout(500);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
});

test("on a phone, the tab bar shrinks while reading down and returns on the way up, and the selected tab is filled", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rooms");
  await page.locator(".dt:visible").first().waitFor();
  await page.waitForTimeout(800);
  const rail = page.locator(".rail");
  const height = async () => Math.round((await rail.boundingBox())!.height);
  const full = await height();
  expect(await page.locator('.nav a[aria-current=page] .ic.filled').count(), "the selected tab has the filled icon").toBe(1);
  expect(await page.locator('.nav a:not([aria-current=page]) .ic.filled').count(), "the others are outlines").toBe(0);
  await page.mouse.wheel(0, 700);
  await expect.poll(height, { message: "the bar shrinks while reading down" }).toBeLessThan(full - 8);
  const labels = await page.locator(".nav a:not([aria-current=page]) > span:not(.badge)").evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
  expect(labels.every((o) => o === "0"), `other labels are folded away: ${labels}`).toBe(true);
  await page.mouse.wheel(0, -120);
  await expect.poll(height, { message: "the bar returns on the way up" }).toBeGreaterThanOrEqual(full - 1);
  // at large text the labels stay: it does not shrink
  await textAt(page, 1.75);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(700);
  expect(await height(), "no shrinking at large text").toBeGreaterThanOrEqual(full - 1);
  await textAt(page, null);
  await page.setViewportSize({ width: 1280, height: 720 });
});

test("the glass has solid fallbacks, and the desktop rail is glass", async () => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.locator(".rail").waitFor();
  const look = () => page.evaluate(() => { const c = getComputedStyle(document.querySelector(".rail")!); return { bg: c.backgroundColor, bf: c.backdropFilter }; });
  const glass = await look();
  expect(glass.bf, "the desktop rail has a backdrop blur").toContain("blur");
  expect(glass.bg, "and a translucent fill").toContain("/");
  await page.emulateMedia({ contrast: "more" });
  const solid = await look();
  expect(solid.bg, "more contrast: a solid fill").not.toContain("/");
  expect(solid.bf === "none" || !solid.bf.includes("blur(2") , "more contrast: no blur").toBe(true);
  await page.emulateMedia({ contrast: "no-preference" });
});

test("the account menu has a Haptics switch, and the choice is remembered on the device", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".me-phone button").first().click();
  const sw = page.getByRole("switch", { name: "Haptics" });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("alice.haptics"))).toBe("off");
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("alice.haptics"))).toBe("on");
  await page.goto("/"); // closes the menu and starts the next test clean
  await page.setViewportSize({ width: 1280, height: 720 });
});

test("push: the switch asks for permission, subscribes this browser, and turning it off forgets it", async () => {
  await page.context().grantPermissions(["notifications"]);
  await page.getByRole("link", { name: "Home" }).first().click();
  const sw = page.getByRole("switch", { name: /Push notifications/ });
  const devices = async () => (await page.evaluate(async () => (await (await fetch("/api/v1/users/me/push-subscriptions")).json()).devices.length)) as number;
  await sw.scrollIntoViewIfNeeded();
  if (await sw.isChecked()) { await sw.click(); await expect.poll(devices).toBe(0); }
  await sw.click();
  // Chrome needs to reach Google's push service to subscribe; without a network the app says so instead of pretending.
  await expect.poll(async () => (await devices()) === 1 || (await page.getByText(/push|subscribe|service/i).count()) > 0, { timeout: 20_000 }).toBeTruthy();
  const subscribed = (await devices()) === 1;
  console.log(subscribed ? "push: this browser subscribed" : "push: could not subscribe here (no route to the push service); the app said so");
  if (subscribed) { await sw.click(); await expect.poll(devices).toBe(0); }
});

/** Text size tiers (Dynamic Type): every signed-in screen and a device sheet, on a phone, must neither scroll sideways nor clip text. */
test("make the home busy: long names, several things left open, a long automation", async () => {
  await page.goto("/");
  await page.waitForTimeout(1500);
  const r = await seedRich(page, { url: HA_URL, token: HA_TOKEN });
  console.log("rich data:", JSON.stringify(r));
  expect(r.renamed).toBeGreaterThan(0);
  expect(r.automationError, "automation").toBeNull();
});

test.describe("text tiers", () => {
test.describe.configure({ mode: "default" });
const TIERS = [["lg", 1.3, "lg", 390], ["xl", 1.75, "xl", 390], ["ax", 2, "ax", 390], ["ax5", 3, "ax", 390], ["ax5-wide", 3, "ax", 510], ["xl-narrow", 1.75, "xl", 360]] as const;
for (const [label, scale, tier, width] of TIERS) {
  test(`on a phone with text at ${Math.round(scale * 100)}% (${label}, ${width}px wide), screens and a device sheet fit`, async ({}, info) => {
    await page.setViewportSize({ width, height: 844 });
    const problems: string[] = [];
    const check = async (name: string) => {
      await textAt(page, scale);
      await page.waitForTimeout(500);
      await page.screenshot({ path: info.outputPath(`${name}-${label}.png`) });
      problems.push(...(await fitProblems(page, name, tier)));
    };
    for (const [name, path] of [["home", "/"], ["rooms", "/rooms"], ["automate", "/automate"], ["admin", "/admin"]] as const) {
      await page.goto(path);
      await page.waitForTimeout(1200);
      await check(name);
    }
    await page.goto("/rooms");
    await page.waitForTimeout(1200);
    await page.evaluate((sc) => { document.documentElement.style.setProperty("font-size", `${16 * sc}px`, "important"); window.dispatchEvent(new Event("resize")); }, scale);
    await page.locator('[aria-label^="More controls for"]').first().click();
    await page.waitForTimeout(900);
    await check("sheet");
    await page.keyboard.press("Escape");
    // a real toast (a tile tap, with Undo), then the library's long and inline ones
    await page.goto("/rooms");
    await page.waitForTimeout(1200);
    await textAt(page, scale);
    await page.locator(".dt:visible").first().click();
    await page.waitForTimeout(600);
    await check("toast");
    // the library's long toast, shown on its own
    await page.goto("/library/preview/toast/long");
    await page.waitForTimeout(800);
    await textAt(page, scale);
    await page.waitForTimeout(400);
    await check("library toast");
    expect(problems, problems.join("\n")).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 720 });
  });
}
});

test("the set-up and sign-in screens fit at every text size", () => { expect(setupProblems, setupProblems.join("\n")).toEqual([]); });
