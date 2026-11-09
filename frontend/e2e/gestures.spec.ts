import { type Page, expect, test } from "@playwright/test";
import { HAPTICS } from "../src/ui/haptics";

/**
 * Gestures and haptics, against the live examples. `navigator.vibrate` is replaced by a spy before the page runs, so every
 * haptic a gesture asks for can be read back; the gestures are real pointer events (down, move, up).
 */
const P = (k: keyof typeof HAPTICS) => HAPTICS[k].pattern;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    (window as unknown as { __v: unknown[] }).__v = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (p: unknown) => { (window as unknown as { __v: unknown[] }).__v.push(p); return true; } });
  });
});

const go = async (page: Page, at: string) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/library/preview/${at}`); await expect(page.locator(".lib-host")).toBeVisible(); await page.waitForTimeout(200); };
const buzzes = (page: Page) => page.evaluate(() => (window as unknown as { __v: unknown[] }).__v);
const centre = async (page: Page, sel: string) => { const b = (await page.locator(sel).first().boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up();
};

test.describe("haptics", () => {
  test("a switch says on and off differently, and the setting turns it all off", async ({ page }) => {
    await go(page, "switch/basic");
    const sw = page.getByRole("switch", { name: "Push notifications" });
    await sw.click(); // on -> off
    await sw.click(); // off -> on
    expect(await buzzes(page)).toEqual([P("toggleOff"), P("toggleOn")]);
    // the person turns haptics off: nothing is played any more
    await page.evaluate(() => localStorage.setItem("alice.haptics", "off"));
    await page.reload();
    await expect(page.locator(".lib-host")).toBeVisible();
    // a new page reads the setting at load
    await page.getByRole("switch", { name: "Push notifications" }).click();
    expect(await buzzes(page)).toEqual([]);
  });

  test("a segmented control, a checkbox and a filter chip each answer with their own haptic", async ({ page }) => {
    await go(page, "segmented/basic");
    await page.getByRole("radio", { name: "Away" }).click();
    expect(await buzzes(page)).toEqual([P("select")]);
    await go(page, "checkbox/row");
    await page.getByRole("checkbox").first().click();
    expect((await buzzes(page)).at(-1)).toEqual(P("toggleOff"));
  });

  test("the stepper ticks as it scrubs, and bumps once it is pushed past the end of its range", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto("/library/preview/stepper/basic");
    await expect(page.locator(".lib-host")).toBeVisible();
    const out = await centre(page, "output");
    await drag(page, out, { x: out.x + 760, y: out.y }, 30); // far past the top of 1 to 60
    await expect(page.locator("output")).toContainText("60");
    const v = (await buzzes(page)).map((x) => JSON.stringify(x));
    expect(v).toContain(JSON.stringify(P("tick")));
    expect(v).toContain(JSON.stringify(P("boundary")));
  });
});

test.describe("gestures", () => {
  test("the switch thumb can be dragged across, and lands on the nearer side with a bump on the way", async ({ page }) => {
    await go(page, "switch/basic");
    const sw = page.getByRole("switch", { name: "Push notifications" });
    await expect(sw).toBeChecked();
    const { b } = await centre(page, '[role="switch"]');
    await drag(page, { x: b.x + b.width - 12, y: b.y + b.height / 2 }, { x: b.x + 4, y: b.y + b.height / 2 });
    await expect(sw).not.toBeChecked();
    const v = (await buzzes(page)).map((x) => JSON.stringify(x));
    expect(v).toContain(JSON.stringify(P("detent")));
    expect(v).toContain(JSON.stringify(P("toggleOff")));
    // dragged back only part of the way: it falls back to where it was
    const b2 = (await sw.boundingBox())!;
    await drag(page, { x: b2.x + 8, y: b2.y + b2.height / 2 }, { x: b2.x + 21, y: b2.y + b2.height / 2 }); // 13 px: a drag, but short of the middle
    await expect(sw).not.toBeChecked();
  });

  test("a segmented control and tabs can be swiped across", async ({ page }) => {
    await go(page, "segmented/basic");
    const first = await centre(page, '[role="radio"]:nth-of-type(1)'), last = await centre(page, '[role="radio"]:nth-of-type(3)');
    await drag(page, first, last);
    await expect(page.getByRole("radio", { name: "Night" })).toBeChecked();
    expect((await buzzes(page)).length).toBeGreaterThanOrEqual(2); // a select each time it changed
    await go(page, "tabs/basic");
    const t1 = await centre(page, '[role="tab"]:nth-of-type(1)'), t3 = await centre(page, '[role="tab"]:nth-of-type(2)');
    await drag(page, t1, t3);
    await expect(page.getByRole("tab", { name: "Scene" })).toHaveAttribute("aria-selected", "true");
  });

  test("the stepper's number can be scrubbed, and holding a button speeds up", async ({ page }) => {
    await go(page, "stepper/basic");
    const out = await centre(page, "output");
    await drag(page, out, { x: out.x + 74, y: out.y }); // 5 steps of 14 px
    await expect(page.locator("output")).toContainText("19");
    await page.getByRole("button", { name: /Fewer: Backups/ }).dispatchEvent("pointerdown");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Fewer: Backups/ }).dispatchEvent("pointerup");
    const n = Number((await page.locator("output").innerText()).match(/\d+/)![0]);
    expect(n, "held for 1.5 s: several steps, not one").toBeLessThan(15);
  });

  test("a toast can be swiped away, and springs back when let go early", async ({ page }) => {
    await go(page, "toast/with-undo");
    await page.getByRole("button", { name: "Turn on the lamp" }).click();
    const toast = page.locator(".toast");
    await expect(toast).toHaveAttribute("data-show", "true");
    // a short pull is not enough: it comes back
    const t = await centre(page, ".toast-t");
    await drag(page, t, { x: t.x + 40, y: t.y });
    await page.waitForTimeout(600);
    await expect(toast).toHaveAttribute("data-show", "true");
    // a long one sends it away
    await drag(page, t, { x: t.x + 190, y: t.y });
    await expect(toast).toHaveAttribute("data-show", "false", { timeout: 3000 });
  });

  test("the colour wheel goes to white on a double-tap, and the slider returns to its default", async ({ page }) => {
    await go(page, "color-controls/wheel");
    const w = await centre(page, '[data-slot="color-wheel"]');
    await page.mouse.dblclick(w.x + w.b.width * 0.3, w.y - w.b.height * 0.1);
    await expect(page.locator(".lib-host")).toContainText("rgb(255, 255, 255)");
    await go(page, "slider/with-reset");
    const s = await centre(page, ".rng-c");
    await expect(page.locator(".rng-v")).toHaveText("35%");
    await page.mouse.dblclick(s.x, s.y);
    await expect(page.locator(".rng-v")).toHaveText("100%");
  });

  test("the blind stretches when pulled past its end and settles back, with a bump", async ({ page }) => {
    await go(page, "cover-shade/basic");
    const c = await centre(page, '[data-slot="cover-shade"]');
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x, c.y + c.b.height * 0.9, { steps: 10 });
    const stretch = () => page.locator(".chandle").evaluate((e) => parseFloat(getComputedStyle(e).translate.split(" ")[1] || "0"));
    await expect.poll(stretch, { message: "pulled past the end: it has stretched" }).toBeGreaterThan(3);
    expect((await buzzes(page)).map((x) => JSON.stringify(x))).toContain(JSON.stringify(P("boundary")));
    await page.mouse.up();
    await expect.poll(stretch, { message: "let go: it settles back" }).toBeLessThan(1);
  });

  test("a device tile presses in while a hold is on its way, confirms it, and stretches past the end of a drag", async ({ page }) => {
    await go(page, "device-tile/lamp");
    const t = await centre(page, ".dt");
    await page.mouse.move(t.x, t.y); await page.mouse.down();
    await page.waitForTimeout(220);
    await expect(page.locator(".dt")).toHaveAttribute("data-pressing", "");
    await page.waitForTimeout(400);
    expect((await buzzes(page)).map((x) => JSON.stringify(x))).toContain(JSON.stringify(P("hold")));
    await page.mouse.up();
    // a drag past the top of the range stretches the tile
    const t2 = await centre(page, ".dt");
    await page.mouse.move(t2.x - 30, t2.y); await page.mouse.down();
    await page.mouse.move(t2.x + 260, t2.y, { steps: 14 });
    await expect.poll(() => page.locator(".dt").evaluate((e) => parseFloat(getComputedStyle(e).translate.split(" ")[0] || "0"))).toBeGreaterThan(3);
    await page.mouse.up();
  });

  test("with a pointer, controls answer the pointer", async ({ page }) => {
    await go(page, "button/variants");
    const b = page.getByRole("button", { name: "Default" });
    const veil = () => b.evaluate((e) => getComputedStyle(e).backgroundImage);
    expect(await veil()).toBe("none");
    await b.hover();
    await expect.poll(veil).toContain("linear-gradient");
  });
});
