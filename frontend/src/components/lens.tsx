/**
 * The edge refraction behind the floating glass (tab bar, Ask button, toasts): an SVG displacement map that bends what is
 * behind the surface a little near its edges, like a convex lens, used as `backdrop-filter: url(#alice-lens)`.
 * Only Chromium renders an SVG filter in a backdrop filter, so the script below marks <html data-lens> there and the CSS
 * (ui/glass.css) uses it only then; everywhere else the glass is the plain blur. Neutral grey = no movement; the bands at
 * the edges pull from the inside (red = sideways, green = up and down).
 */
export const LENS_SCRIPT = `(function(){try{var b=navigator.userAgentData&&navigator.userAgentData.brands;if(b&&b.some(function(x){return /Chromium|Google Chrome/.test(x.brand)}))document.documentElement.setAttribute('data-lens','')}catch(e){}})()`;

const MAP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">
<defs>
<linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="rgb(255,128,128)"/><stop offset="1" stop-color="rgb(128,128,128)" stop-opacity="0"/></linearGradient>
<linearGradient id="r" x1="0" x2="1"><stop offset="0" stop-color="rgb(128,128,128)" stop-opacity="0"/><stop offset="1" stop-color="rgb(0,128,128)"/></linearGradient>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(128,255,128)"/><stop offset="1" stop-color="rgb(128,128,128)" stop-opacity="0"/></linearGradient>
<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(128,128,128)" stop-opacity="0"/><stop offset="1" stop-color="rgb(128,0,128)"/></linearGradient>
</defs>
<rect width="100" height="100" fill="rgb(128,128,128)"/>
<rect width="7" height="100" fill="url(#l)"/><rect x="93" width="7" height="100" fill="url(#r)"/>
<rect width="100" height="34" fill="url(#t)"/><rect y="66" width="100" height="34" fill="url(#b)"/>
</svg>`;

export function LensDefs() {
  const href = `data:image/svg+xml;utf8,${encodeURIComponent(MAP)}`;
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }} focusable="false">
      <filter id="alice-lens" x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
        <feImage href={href} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="26" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
