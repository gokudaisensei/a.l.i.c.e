import { AxeBuilder } from "@axe-core/playwright";
import { type ConsoleMessage, type Page, expect, test } from "@playwright/test";
import { fitProblems } from "./fit.mjs";
import { entries, foundations } from "../src/library/registry";

/**
 * The component library: every page and every example is opened, scanned for accessibility problems in light and in dark,
 * and checked at large text and on a phone. Needs no backend: the library is public.
 */
const PAGES = ["/library", ...foundations.map((f) => `/library/foundations/${f.slug}`), ...entries.map((e) => `/library/components/${e.slug}`)];
const EXAMPLES = entries.flatMap((e) => e.examples.map((x) => ({ slug: e.slug, name: x.name, title: x.title })));

/** Console noise that is not the page's doing. */
const IGNORED = [/Download the React DevTools/];

/** Collects console errors, each tagged with the page it happened on (`where.now`). */
function watch(page: Page, where: { now: string }) {
  const bad: string[] = [];
  page.on("pageerror", (e) => bad.push(`${where.now}: page error: ${e.message}`));
  page.on("console", (m: ConsoleMessage) => { if (m.type() === "error" && !IGNORED.some((r) => r.test(m.text()))) bad.push(`${where.now}: console error: ${m.text().slice(0, 900)} ${m.location().url ? `[${m.location().url}]` : ""}`); });
  return bad;
}

/** WCAG 2.x A and AA, through axe. `page-level` rules do not apply to a bare example in a frame. */
async function scan(page: Page, where: string, bare = false) {
  const out: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
    if (bare) b = b.disableRules(["region", "page-has-heading-one", "landmark-one-main", "document-title"]);
    const r = await b.analyze();
    for (const v of r.violations) {
      const detail = (n: (typeof v.nodes)[number]) => { const d = n.any[0]?.data as { contrastRatio?: number; fgColor?: string; bgColor?: string; expectedContrastRatio?: string } | undefined; return d?.contrastRatio ? ` [${d.contrastRatio.toFixed(2)}:1, needs ${d.expectedContrastRatio}, ${d.fgColor} on ${d.bgColor}]` : ""; };
      out.push(`${where} (${scheme}): ${v.id} (${v.impact}): ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + detail(n)).join(" | ")}`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  return out;
}

const textAt = (page: Page, scale: number) => page.evaluate((sc) => { document.documentElement.style.setProperty("font-size", `${16 * sc}px`, "important"); window.dispatchEvent(new Event("resize")); }, scale);

test.describe("library pages", () => {
  test("every docs page renders, is accessible in light and dark, and fits on a phone", async ({ browser }) => {
    test.setTimeout(900_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const where = { now: "" };
    const errors = watch(page, where);
    const problems: string[] = [];
    for (const path of PAGES) {
      where.now = path;
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);
      await expect(page.locator("h1").first(), `${path}: has a title`).toBeVisible();
      await page.waitForTimeout(400);
      problems.push(...(await scan(page, path)));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
      problems.push(...(await fitProblems(page, `${path} at 390px`)));
    }
    expect.soft(errors, errors.join("\n")).toEqual([]);
    expect.soft(problems, problems.join("\n")).toEqual([]);
    await ctx.close();
  });

  test("every example renders alone, is accessible in light and dark, and fits at large text", async ({ browser }) => {
    test.setTimeout(900_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const where = { now: "" };
    const errors = watch(page, where);
    const problems: string[] = [];
    for (const ex of EXAMPLES) {
      const at = `${ex.slug}/${ex.name}`;
      where.now = at;
      await page.goto(`/library/preview/${at}`);
      await expect(page.locator(".lib-host"), `${at}: renders`).toBeVisible();
      await page.waitForTimeout(250);
      problems.push(...(await scan(page, at, true)));
      await textAt(page, 2);
      await page.waitForTimeout(250);
      problems.push(...(await fitProblems(page, `${at} at 200% text`)));
    }
    expect.soft(errors, errors.join("\n")).toEqual([]);
    expect.soft(problems, problems.join("\n")).toEqual([]);
    await ctx.close();
  });

  test("the registry serves every component with its files", async ({ request }) => {
    const index = await (await request.get("/r/registry.json")).json();
    expect(index.items.length).toBe(entries.length);
    for (const item of index.items as { name: string }[]) {
      const r = await request.get(`/r/${item.name}.json`);
      expect(r.ok(), `/r/${item.name}.json`).toBe(true);
      const body = await r.json();
      expect(body.files.length, `${item.name} has files`).toBeGreaterThan(0);
      for (const f of body.files) expect(f.content.length, `${item.name}: ${f.path} has content`).toBeGreaterThan(20);
    }
  });
});

test.describe("library controls", () => {
  test("the preview toolbar changes the frame, and the page has a filter and copy", async ({ page }) => {
    await page.goto("/library/components/button");
    const frame = page.locator("iframe").first();
    await expect(frame).toBeVisible();
    await page.getByRole("radio", { name: "Phone" }).first().click();
    await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(390);
    await page.getByRole("radio", { name: "Wide" }).first().click();
    await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBeGreaterThan(500);

    // text size: the frame's own root size changes, and its tier follows
    await page.getByRole("combobox", { name: "Text size" }).first().click();
    await page.getByRole("option", { name: "Text 200%" }).click();
    const inner = page.frameLocator("iframe").first();
    await expect.poll(async () => inner.locator("html").evaluate((h) => parseFloat(getComputedStyle(h).fontSize)).catch(() => 0)).toBe(32); // the frame reloads when the size changes: poll through it
    await expect.poll(async () => inner.locator("html").getAttribute("data-text").catch(() => "")).toBe("ax");

    // the frame sizes to its example
    const h = Math.round((await frame.boundingBox())!.height);
    expect(h).toBeGreaterThan(90);
    expect(h).toBeLessThan(500);

    // filter
    await page.getByPlaceholder(/Filter/).fill("toast");
    await expect(page.getByRole("link", { name: "Toast" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Button", exact: true })).toHaveCount(0);
    await page.getByPlaceholder(/Filter/).fill("");

    // every section the page promises is there, and the API table is generated
    for (const id of ["examples", "usage", "api", "anatomy", "gestures", "a11y", "guidance", "source", "install", "related"]) await expect(page.locator(`#${id}`), id).toHaveCount(1);
    await expect(page.locator("#api table").first().getByText("variant")).toBeVisible();
    await expect(page.locator("#api").getByText("loading").first()).toBeVisible();

    // copy
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy code" }).first().click();
    await expect(page.getByRole("button", { name: "Copied" }).first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Button");
  });

  test("an example's source is the file that runs", async ({ page }) => {
    await page.goto("/library/components/switch");
    await expect(page.locator("pre").first()).toContainText("Switch");
    await expect(page.locator(".lib-code figcaption").first()).toHaveText("switch/basic.tsx");
  });
});
