import { type Page, expect, test } from "@playwright/test";
import { entries } from "../src/library/registry";

/**
 * Touch targets. Apple's guidance: a control is at least 44 x 44 pt by default, and never below 28. This opens every
 * example on a touch viewport and measures what a finger can actually hit: it probes outward from the middle of each
 * interactive element with elementFromPoint, so a padded invisible hit area counts and a bigger-looking neighbour does not.
 */
const MIN = 44;
const FLOOR = 28; // never below, even for dense, adjacent controls
const EXAMPLES = entries.flatMap((e) => e.examples.map((x) => `${e.slug}/${x.name}`));

/** Controls whose own hit area is not the thing to measure: the slider thumb is inside a larger track that takes the drag. */
const SKIP = [".rng-th"];

async function measure(page: Page) {
  return page.evaluate(({ skip }) => {
    const out: { what: string; w: number; h: number }[] = [];
    const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=slider], [role=switch], [role=checkbox], [role=radio], [role=tab], [role=button], [role=combobox]';
    const owns = (hit: Element | null, el: Element) => !!hit && (hit === el || el.contains(hit));
    const extent = (el: Element, cx: number, cy: number, dx: number, dy: number) => {
      let d = 0;
      while (d < 60) { const hit = document.elementFromPoint(cx + dx * (d + 1), cy + dy * (d + 1)); if (!owns(hit, el)) break; d++; }
      return d;
    };
    document.querySelectorAll(sel).forEach((el) => {
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (b.width === 0 || b.height === 0 || cs.visibility === "hidden" || cs.pointerEvents === "none" || (el as HTMLInputElement).disabled) return;
      if (skip.some((s) => el.matches(s) || el.closest(s))) return;
      if (el.getAttribute("tabindex") === "-1") return; // an inert chip: not a control
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      if (!owns(document.elementFromPoint(cx, cy), el)) return; // covered or off screen: not measurable here
      const w = extent(el, cx, cy, -1, 0) + extent(el, cx, cy, 1, 0) + 1, h = extent(el, cx, cy, 0, -1) + extent(el, cx, cy, 0, 1) + 1;
      const name = `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[${el.getAttribute("data-slot")}]` : ""}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}.${String((el as HTMLElement).className).trim().split(/\s+/).slice(0, 2).join(".")} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 20)}"`;
      out.push({ what: name, w: Math.round(w), h: Math.round(h) });
    });
    return out;
  }, { skip: SKIP });
}

test("every interactive control can be hit with a finger (44 pt, never under 28)", async ({ browser }) => {
  test.setTimeout(600_000);
  // a touch phone, so `(pointer: coarse)` rules apply
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const tooSmall: string[] = [], tooTight: string[] = [];
  for (const at of EXAMPLES) {
    await page.goto(`/library/preview/${at}`);
    await expect(page.locator(".lib-host")).toBeVisible();
    await page.waitForTimeout(200);
    for (const m of await measure(page)) {
      if (m.w < FLOOR || m.h < FLOOR) tooTight.push(`${at}: ${m.what} is ${m.w}x${m.h}`);
      else if (m.w < MIN || m.h < MIN) tooSmall.push(`${at}: ${m.what} is ${m.w}x${m.h}`);
    }
  }
  expect.soft(tooTight, `under ${FLOOR}:\n${tooTight.join("\n")}`).toEqual([]);
  expect.soft(tooSmall, `under ${MIN}:\n${tooSmall.join("\n")}`).toEqual([]);
  await ctx.close();
});
