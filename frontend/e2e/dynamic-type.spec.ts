import { test, expect } from "@playwright/test";

/** Text size follows the person's setting (rem units): at double size on a phone nothing should push the page sideways. */
for (const scale of [1, 1.5, 2]) {
  test(`phone width, text at ${scale * 100}%: the page does not scroll sideways`, async ({ browser }, info) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto("/library");
    await page.addStyleTag({ content: `html{font-size:${16 * scale}px !important}` });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: info.outputPath(`library-${scale}.png`), fullPage: false });
    expect(over, "horizontal overflow in px").toBeLessThanOrEqual(1);
    await ctx.close();
  });
}
