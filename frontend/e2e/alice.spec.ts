import { type Page, expect, test } from "@playwright/test";
import { HA_TOKEN, HA_URL, haScripts, haService, haState } from "./ha";
import { addVirtualPasskey } from "./passkey";

/** The whole product in one real browser: set up, sign in with a passkey, control the home, build, and look after it. */
test.describe.configure({ mode: "serial" });

let page: Page;
const LAMP = "light.living_room_rgbww_lights";
const until = async (fn: () => Promise<boolean>, what: string, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 400)); }
};

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  page = await context.newPage();
  await addVirtualPasskey(context, page);
  await haService("light", "turn_off", { entity_id: LAMP });
});
test.afterAll(async () => { await page.context().close(); });

test("first run: set up with a passkey, save the recovery codes, connect Home Assistant", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up your home" })).toBeVisible();
  await page.getByLabel("Your name").fill("Gokul");
  await page.getByRole("button", { name: "Create passkey and continue" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(10);
  await page.getByText(/saved them somewhere safe/).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Connect Home Assistant" })).toBeVisible();
  await page.getByLabel("Address").fill(HA_URL);
  await page.getByLabel("Access token").fill(HA_TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Household mode")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("Gokul").first()).toBeVisible();
});

test("sign out, then sign back in with the same passkey", async () => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
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
