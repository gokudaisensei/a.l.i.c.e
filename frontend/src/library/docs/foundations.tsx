import Link from "next/link";
import type { ReactNode } from "react";
import { entries, foundations } from "../registry";
import { Colors, HapticsLab, Icons, Materials, Motion, TextSize } from "./foundations-client";
import { CodeBlock } from "./code-block";

const Box = ({ children, r, style }: { children?: ReactNode; r?: string; style?: React.CSSProperties }) => (
  <div style={{ background: "var(--tile)", boxShadow: "var(--shadow)", borderRadius: r, padding: 14, minWidth: 0, ...style }}>{children}</div>
);

function Introduction() {
  return (
    <div className="lib-prose">
      <p className="lib-lede">Alice is a calm, plain-spoken home for a smart home, used a hundred times a day with one thumb, often in the dark, often by someone who did not set it up. This library is how that is made: {entries.length} component pages, the tokens under them, and the rules that keep them one family.</p>
      <h2>How it is built</h2>
      <ul>
        <li><b>You own the code.</b> The components live in <code>src/ui</code>. There is no package to upgrade: copy a file, change it. The pages here show the source as it is now, and the registry publishes the same files.</li>
        <li><b>Built on Base UI.</b> Behaviour (focus, keyboard, dismissal) comes from unstyled Base UI primitives; the look comes from design tokens in CSS.</li>
        <li><b>One contract.</b> Every component accepts <code>className</code>, passes native props and <code>ref</code> through, tags its parts with <code>data-slot</code>, and names its variants with <code>cva</code>. See Contributing.</li>
        <li><b>Tokens, not values.</b> Colour, type, radius, motion and material are tokens, so a component follows the theme, the text size and the accessibility settings without extra work.</li>
        <li><b>Documented from the code.</b> The API tables are read from the TypeScript, the examples are real files, and tests open every page.</li>
      </ul>
      <h2>Principles</h2>
      <ul>
        <li><b>Trust before delight.</b> Never show a state that is not confirmed; dangerous actions step up to a passkey.</li>
        <li><b>The tile is the control.</b> The common action happens on the tile; the sheet is for the rare one.</li>
        <li><b>Touch first, thumb first.</b> Designed at 390 px; important things in the lower two thirds.</li>
        <li><b>Direct manipulation, with a visible twin.</b> Prefer dragging the thing, but a gesture is never the only way.</li>
        <li><b>Quiet by default.</b> One accent at a time; motion only when it explains something.</li>
        <li><b>Honest and plain.</b> Say what happened in everyday words.</li>
      </ul>
      <p className="lib-note">The full language, with the reasons, is in <code>frontend/DESIGN.md</code>.</p>
      <h2>Start</h2>
      <CodeBlock lang="ts" code={'import { Button, Switch, DeviceTile } from "@/ui";'} />
      <div className="btns"><Link className="btn btn--p" href="/library/components/button">Browse the components</Link><Link className="btn" href="/library/foundations/contributing">How to contribute</Link></div>
    </div>
  );
}

const STYLES: [string, string, string][] = [["ts-largetitle", "Large title", "2.125rem · 800 · display, condensed"], ["ts-title1", "Title 1", "1.75rem · 760"], ["ts-title2", "Title 2", "1.375rem · 700"], ["ts-title3", "Title 3", "1.1875rem · 650"], ["ts-headline", "Headline", "1.0625rem · 650"], ["ts-body", "Body", ".9375rem · 400"], ["ts-callout", "Callout", ".875rem · 500"], ["ts-subhead", "Subhead", ".8125rem · 500"], ["ts-footnote", "Footnote", ".78rem · 500"], ["ts-caption", "Caption", ".6875rem · mono"]];
function Typography() {
  return (
    <div className="lib-prose" style={{ maxWidth: "none" }}>
      <p>Three typefaces. <b>Bricolage Grotesque</b> (condensed, tight) for the brand, titles and big numbers; <b>Instrument Sans</b> for everything else; <b>JetBrains Mono</b> for codes, ids and times only. All sizes are in <code>rem</code>, so they follow the person&apos;s text size. Use the text styles instead of inventing a size.</p>
      <div>{STYLES.map(([cls, name, spec]) => (
        <div key={cls} className="lib-specimen"><code>.{cls}<br />{spec}</code><div className={cls}>{name}: the garage door is closing</div></div>
      ))}</div>
      <h2>Rules</h2>
      <ul><li>Numbers that change use tabular figures (<code>.num</code>), so they do not jitter.</li><li>Avoid light weights at small sizes.</li><li>Never truncate a state like “Unlocked”: let text wrap, and restack the layout when text is large.</li></ul>
    </div>
  );
}

function Surfaces() {
  return (
    <div className="lib-prose" style={{ maxWidth: "none" }}>
      <h2>Radius</h2>
      <p className="lib-note">An inner shape&apos;s radius is its container&apos;s radius minus the padding between them, so nested corners stay parallel.</p>
      <div className="lib-cards">{[["22px", "Tiles and sheets (--radius)"], ["18px", "Phone tiles"], ["16px", "Rows, nav items"], ["12px", "Inputs"], ["99px", "Pills, chips, the Ask bar"], ["50%", "Dials and wheels"]].map(([r, n]) => <Box key={r} r={r}><b className="num">{r}</b><br /><small>{n}</small></Box>)}</div>
      <h2>Depth</h2>
      <p>One soft shadow with a faint top highlight (<code>--shadow</code>), not borders. Hairlines (<code>--line</code>) are for tracks and wells.</p>
      <div className="lib-cards"><Box r="22px"><b>--shadow</b><br /><small>Cards and tiles</small></Box><Box r="22px" style={{ boxShadow: "none", background: "var(--tile2)" }}><b>--tile2</b><br /><small>A well: no shadow</small></Box></div>
      <h2>Spacing and touch</h2>
      <ul><li>A 4 and 8 point grid; 16 px page gutter; 10 to 12 px between tiles; 14 px inside cards.</li><li><b>Touch targets are at least 44 px</b> (never under 28). On a touch screen <code>ui/touch.css</code> gives each small control an invisible hit area up to that size, so nothing looks bigger. A test probes the real hit area of every control in every example. Around a control with a bezel leave about 12 px, without one about 24 px.</li><li><b>Flicks carry on.</b> A drag control lets a flick land where its speed would take it (<code>useDrag</code> and <code>project</code>), as a scroll view does; while the finger is down it follows exactly.</li><li><b>A gesture is never the only way.</b> Beside every drag control there is a visible twin: <code>Nudge</code>.</li><li>Keep a 16 px gutter and the safe-area insets on a phone.</li></ul>
    </div>
  );
}

function Layout() {
  const cell = (n: number) => <div key={n} style={{ background: "var(--tile2)", borderRadius: 12, padding: 10, minWidth: 0 }}>Item {n}</div>;
  return (
    <div className="lib-prose" style={{ maxWidth: "none" }}>
      <p>Reach for these before writing a one-off flex or grid. They wrap by default, so a layout survives a narrow screen and large text. Fixed pixel widths and heights are for icons, tracks and dials only.</p>
      <h2><code>.stack</code></h2><p className="lib-note">A column with a gap (<code>--gap</code>).</p>
      <div className="stack" style={{ maxWidth: 360 }}>{[1, 2, 3].map(cell)}</div>
      <h2><code>.cluster</code></h2><p className="lib-note">A row that wraps.</p>
      <div className="cluster">{[1, 2, 3, 4, 5, 6].map(cell)}</div>
      <h2><code>.autogrid</code></h2><p className="lib-note">Columns of at least <code>--min</code>, one column when there is no room for two.</p>
      <div className="autogrid" style={{ ["--min" as string]: "9rem" }}>{[1, 2, 3, 4, 5].map(cell)}</div>
      <h2><code>.clip</code> and <code>.breaks</code></h2><p className="lib-note"><code>.clip</code> truncates one line on purpose; <code>.breaks</code> lets long words break rather than push a layout wider.</p>
      <div style={{ maxWidth: 260 }}><div className="clip">A very long device name that will not fit on one line</div><div className="breaks">Supercalifragilisticexpialidocious_device_name_without_spaces</div></div>
    </div>
  );
}

function TextSizePage() {
  return (
    <div className="lib-prose" style={{ maxWidth: "none" }}>
      <TextSize />
      <p>The layout adapts to the person&apos;s text size instead of just getting bigger and breaking. A small script reads the root text size and sets <code>&lt;html data-text&gt;</code>; the CSS in <code>ui/tiers.css</code> restacks what cannot simply wrap.</p>
      <div className="lib-scroll"><table className="lib-table"><thead><tr><th>Tier</th><th>Text size</th><th>What changes</th></tr></thead><tbody>
        <tr><td><code>std</code></td><td>to 115%</td><td>The designed layout.</td></tr>
        <tr><td><code>lg</code></td><td>to 150%</td><td>Three small columns become two; the lock strip stacks.</td></tr>
        <tr><td><code>xl</code></td><td>to 200%</td><td>Buttons, chips and segmented controls wrap; rows restack; the top bar drops the words from “Live”; nothing is cut short.</td></tr>
        <tr><td><code>ax</code></td><td>200% and up</td><td>One column of device tiles; chips wrap instead of scrolling.</td></tr>
      </tbody></table></div>
      <h2>Rules for components</h2>
      <ul><li>Write sizes in <code>rem</code>, never <code>px</code>. Icons and hit targets stay in px.</li><li>Text-bearing boxes use <code>min-height</code>, not <code>height</code>.</li><li>Let text wrap; truncate only on purpose, with an ellipsis.</li><li>Chrome (the tab bar, top bar) grows with text and then stops.</li><li>The checks: <code>npm run lint:css</code> and the text-tier tests open every page and a device sheet at 130, 175, 200 and 300% and fail on sideways scrolling, clipped, squeezed or cut-off text.</li></ul>
      <p className="lib-note">Every example on this site has a Text size control: use it to see the component at each size.</p>
    </div>
  );
}

function Contributing() {
  return (
    <div className="lib-prose">
      <h2>The component contract</h2>
      <ul>
        <li><b>The root element</b> takes <code>className</code> (merged with <code>cn</code>), passes the rest of its native props through (<code>ComponentProps&lt;&quot;button&quot;&gt;</code> and so on), and forwards <code>ref</code> (a plain prop in React 19).</li>
        <li><b>Every part has a <code>data-slot</code></b>, and state is on <code>data-*</code> or <code>aria-*</code> attributes, so it can be styled and tested without class names.</li>
        <li><b>Variants use <code>cva</code></b>, and the recipe is exported (<code>buttonVariants</code>), so a link can wear a button&apos;s look.</li>
        <li><b>Values are controlled</b>: <code>value</code> and <code>onChange(next)</code> with the new value, not an event.</li>
        <li><b>A name is required where there is no text</b>: icon buttons and sliders take a typed <code>aria-label</code> or <code>label</code>.</li>
        <li><b>Every prop has a doc comment</b>: it becomes the API table. The generator fails if one is missing.</li>
        <li><b>No app state.</b> Nothing in <code>src/ui</code> imports from <code>@/lib</code>; behaviour comes in through props. App-specific wrappers live in <code>src/components</code>.</li>
        <li><b>Tokens only.</b> No hex values, no new easing curves, <code>rem</code> for text.</li>
      </ul>
      <h2>Adding a component</h2>
      <ol style={{ display: "flex", flexDirection: "column", gap: 8, color: "var(--ink2)" }}>
        <li>Write it in <code>src/ui/&lt;name&gt;.tsx</code> with its stylesheet <code>&lt;name&gt;.css</code> (imported in <code>styles.css</code>) and export it from <code>src/ui/index.ts</code>.</li>
        <li>Make the root follow the contract above, and give it and every prop a doc comment.</li>
        <li>Add a page: <code>src/library/entries/&lt;slug&gt;.ts</code> (typed as <code>Entry</code>: description, exports, files, examples, anatomy, accessibility, guidance) and one file per example in <code>src/library/examples/&lt;slug&gt;/</code> (each starts with <code>&quot;use client&quot;</code>: examples pass event handlers).</li>
        <li>Run <code>node scripts/build-library.mjs</code>. It reads the props from the TypeScript, writes the generated files and the registry, and tells you what is missing.</li>
        <li>Look at the page at each width and text size; the tests open it with the rest (accessibility, text tiers, themes).</li>
      </ol>
      <h2>Checks that run in CI</h2>
      <ul><li><code>node scripts/build-library.mjs --check</code>: every export documented, every example listed, generated files current.</li><li><code>npm run lint:css</code>: rem for text, no stray fixed heights, no stray nowrap.</li><li>The library tests: every page renders without errors, passes an accessibility scan in light and dark, and fits at large text.</li></ul>
    </div>
  );
}

function Gestures() {
  const rows = entries.filter((e) => e.gestures?.length);
  return (
    <div className="lib-prose" style={{ maxWidth: "none" }}>
      <p>Every control uses the same few gestures, so a person who has learned one has learned them all. They come from Apple&apos;s guidance on gestures and fluid interfaces, adapted to a home.</p>
      <h2>The grammar</h2>
      <div className="lib-scroll"><table className="lib-table"><thead><tr><th>Gesture</th><th>Means</th></tr></thead><tbody>
        <tr><td>Tap</td><td>The main action: toggle, choose, press.</td></tr>
        <tr><td>Drag</td><td>Set a value. The control follows the finger exactly, previews while held, and commits once on release.</td></tr>
        <tr><td>Flick</td><td>A drag released with speed carries on and lands where its speed would take it (<code>project</code>), as a scroll view does.</td></tr>
        <tr><td>Swipe across</td><td>Choose among neighbours by sliding over them: segmented controls and tabs.</td></tr>
        <tr><td>Hold</td><td>More controls. A slight press-in shows the hold is coming, and a firm tap confirms it was recognised.</td></tr>
        <tr><td>Double-tap</td><td>Go back to a default: a slider to its default, the colour wheel to white.</td></tr>
        <tr><td>Scrub</td><td>Drag a number sideways to change it, one step every few pixels.</td></tr>
        <tr><td>Swipe away</td><td>Dismiss a message: sideways, or down.</td></tr>
        <tr><td>Pull past the end</td><td>The control stretches with growing resistance and bumps, then settles back (rubber-banding): the end is felt, not a wall.</td></tr>
      </tbody></table></div>
      <h2>Rules</h2>
      <ul>
        <li><b>A gesture is never the only way.</b> Every function also has a visible control or a key: a chevron for hold, plus and minus beside a drag (<code>Nudge</code>), arrow keys, a Close button for a swipe.</li>
        <li><b>Preview locally, commit once.</b> While a finger is down only the control changes; one command is sent on release, so history and undo stay clean.</li>
        <li><b>Direct manipulation first.</b> Nothing animates behind a finger that is down; the glide comes after release and can be interrupted.</li>
        <li><b>Never fight the system.</b> Vertical movement is left to scrolling; edge swipes are not taken; a drag inside a sheet does not close it.</li>
        <li><b>Dangerous things are deliberate.</b> A swipe or a drag never unlocks a door: it takes a passkey.</li>
      </ul>
      <h2>Which component answers what</h2>
      <p className="lib-note">Read from each component&apos;s own page, so it cannot drift.</p>
      <div className="lib-scroll"><table className="lib-table"><thead><tr><th>Component</th><th>Gestures</th></tr></thead><tbody>
        {rows.map((e) => <tr key={e.slug}><td><Link href={`/library/components/${e.slug}`}>{e.title}</Link></td><td>{e.gestures!.map((g) => g.gesture).join(", ")}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

function Haptics() {
  return (
    <div className="lib-prose" style={{ maxWidth: "none" }}>
      <p>Haptics are punctuation, not decoration. Components never ask to &ldquo;vibrate for 12 ms&rdquo;: they say what happened, and <code>haptic()</code> decides what that feels like, how often it may happen, and whether the person wants it. All of it lives in <code>ui/haptics.ts</code>.</p>
      <HapticsLab />
      <h2>Rules</h2>
      <ul>
        <li><b>Say what happened</b> (<code>haptic(&quot;toggleOn&quot;)</code>), never a duration.</li>
        <li><b>On and off differ.</b> Switching on is a touch firmer than off, so you can tell without looking.</li>
        <li><b>Ticks are rate limited.</b> A fast drag must not turn into a buzz: <code>tick</code> and <code>detent</code> cannot repeat faster than every 28 ms.</li>
        <li><b>Reaching an end bumps</b> (<code>boundary</code>), once, when you arrive.</li>
        <li><b>Results match their tone</b>: a warning toast is felt as a warning, a success as a success, a plain note is silent.</li>
        <li><b>Never the only signal.</b> Every haptic is paired with something visible, because many devices cannot vibrate and many people turn it off.</li>
        <li><b>The person decides.</b> The account menu has a Haptics switch; it is remembered on the device.</li>
      </ul>
      <h2>Platforms</h2>
      <ul>
        <li><b>Android Chrome</b> vibrates through <code>navigator.vibrate</code>: a plain pulse whose length is the only strength control, and some phones ignore pulses under about 10 ms. It needs a recent touch, so it cannot fire from a timer.</li>
        <li><b>iPhone</b> has no vibration API. Where the platform allows it, a hidden <code>switch</code> checkbox is clicked, which Safari answers with a tap (iOS 17.4 and later). This path has not been tried on a device.</li>
        <li><b>Desktop</b> browsers do nothing, and nothing breaks.</li>
      </ul>
    </div>
  );
}

const PAGES: Record<string, () => ReactNode> = {
  gestures: Gestures,
  haptics: Haptics,
  introduction: Introduction,
  colors: Colors,
  typography: Typography,
  surfaces: Surfaces,
  motion: Motion,
  materials: Materials,
  icons: Icons,
  layout: Layout,
  "text-size": TextSizePage,
  contributing: Contributing,
};

export function FoundationPage({ slug }: { slug: string }) {
  const f = foundations.find((x) => x.slug === slug);
  const Body = PAGES[slug];
  if (!f || !Body) return null;
  return (
    <article className="lib-article" data-slug={slug}>
      <header className="lib-head"><div className="lib-eyebrow">Foundations</div><h1>{f.title}</h1><p className="lib-lede">{f.description}</p></header>
      <Body />
    </article>
  );
}
