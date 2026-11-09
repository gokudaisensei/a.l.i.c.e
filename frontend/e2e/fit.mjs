/**
 * "Does this screen fit?" for text-size tests, shared by the Playwright suite (headless Chrome) and the phone script
 * (Chrome on a real phone over its debug port). Runs in the page; returns problems as readable lines.
 *  - sideways: the page is wider than the window, or something sticks out of it (outside a deliberate scroller)
 *  - clipped: text cut off by overflow:hidden without an ellipsis (a two-line clamp is allowed at std and lg only)
 *  - tier: <html data-text> is what the root font size says it should be
 */
export async function fitProblems(page, name, expectedTier) {
  const res = await page.evaluate(() => {
    const w = window.innerWidth;
    const inScroller = (e) => { for (let a = e.parentElement; a; a = a.parentElement) { if (["auto", "scroll"].includes(getComputedStyle(a).overflowX) && a !== document.body && a !== document.documentElement) return true; } return false; };
    const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(" ").join(".")}"${(el.textContent ?? "").trim().slice(0, 24)}"`;
    const over = [], clipped = [];
    document.querySelectorAll("body *").forEach((el) => {
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (b.width === 0 || cs.visibility === "hidden" || el.closest("svg")) return;
      if (b.right > w + 1 && !inScroller(el) && !el.closest("[data-fixed-ok]")) over.push(`${label(el)} +${Math.round(b.right - w)} in ${el.parentElement?.tagName.toLowerCase()}.${String(el.parentElement?.className).trim().split(" ").join(".")}`);
      const small = ["std", "lg"].includes(document.documentElement.dataset.text ?? "");
      if (["hidden", "clip"].includes(cs.overflowX) && el.clientWidth > 2 && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== "ellipsis" && !(cs.webkitLineClamp !== "none" && small) && (el.textContent ?? "").trim() && !el.hasAttribute("data-clip-ok") && !/(^|\s)(sr|dfill|cwheel|wstrip|dial|cshade|phero|hero|auth)(\s|$)/.test(String(el.className))) clipped.push(`${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
    });
    const squeezed = [];
    document.querySelectorAll("body *").forEach((e) => {
      const t = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join("").trim(), b = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (t.length >= 5 && b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && !e.closest("svg,.sr") && b.width < parseFloat(cs.fontSize) * 1.5 && b.height > parseFloat(cs.fontSize) * 3) squeezed.push(`${label(e)} ${Math.round(b.width)}x${Math.round(b.height)}`);
    });
    // a row that scrolls sideways but whose first items start before its left edge (centred overflow) cannot be scrolled back to
    const unreachable = [];
    document.querySelectorAll("body *").forEach((sc) => {
      if (!["auto", "scroll"].includes(getComputedStyle(sc).overflowX) || sc.scrollWidth <= sc.clientWidth + 2 || sc.scrollLeft !== 0) return;
      const left = sc.getBoundingClientRect().left;
      for (const c of sc.children) { const r = c.getBoundingClientRect(); if (r.width > 0 && r.left < left - 2) unreachable.push(`${label(c)} starts ${Math.round(left - r.left)}px before its scroller ${label(sc)}`); }
    });
    const px = document.documentElement.scrollWidth - w;
    const wide = px > 1 && !over.length ? [...document.querySelectorAll("body *")].filter((e) => e.scrollWidth > w + 1 && !inScroller(e) && !["auto", "scroll"].includes(getComputedStyle(e).overflowX) && ![...e.children].some((c) => c.scrollWidth > w + 1)).slice(0, 4).map((e) => `${label(e)} scroll ${e.scrollWidth}`) : [];
    const any = px > 1 && !over.length && !wide.length ? [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && e.getBoundingClientRect().width > 0).slice(0, 4).map((e) => `${label(e)} right ${Math.round(e.getBoundingClientRect().right)} pos ${getComputedStyle(e).position}`) : [];
    const culprits = [];
    if (px > 1 && !over.length) {
      const all = [...document.querySelectorAll("body *")];
      for (const e of all) { const prev = e.style.display; e.style.display = "none"; const fixed = document.documentElement.scrollWidth - innerWidth <= 1; e.style.display = prev; if (fixed && ![...e.children].some((c) => { const pd = c.style.display; c.style.display = "none"; const f = document.documentElement.scrollWidth - innerWidth <= 1; c.style.display = pd; return f; })) { culprits.push(`culprit ${label(e)} pos ${getComputedStyle(e).position}`); if (culprits.length >= 3) break; } }
    }
    const dims = px > 1 ? [`doc ${document.documentElement.scrollWidth} body ${document.body.scrollWidth} inner ${innerWidth} client ${document.documentElement.clientWidth} vv ${window.visualViewport?.width}`] : [];
    return { px, dims, unreachable: unreachable.slice(0, 3), squeezed: squeezed.slice(0, 4), tier: document.documentElement.dataset.text, over: [...over, ...wide, ...any, ...culprits, ...dims].slice(0, 7), clipped: clipped.slice(0, 6) };
  });
  const out = [];
  if (expectedTier && res.tier !== expectedTier) out.push(`${name}: data-text is ${res.tier}, expected ${expectedTier}`);
  if (res.px > 1 || res.over.length) out.push(`${name}: sideways ${res.px}px: ${res.over.join(" | ")}`);
  if (res.unreachable.length) out.push(`${name}: part of a scrolling row is cut off and cannot be scrolled to: ${res.unreachable.join(" | ")}`);
  if (res.squeezed.length) out.push(`${name}: squeezed text (a column far too narrow): ${res.squeezed.join(" | ")}`);
  if (res.clipped.length) out.push(`${name}: clipped text: ${res.clipped.join(" | ")}`);
  return out;
}
