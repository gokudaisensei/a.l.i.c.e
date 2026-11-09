# Alice design language

How Alice looks, moves and speaks, and why. The tokens and components named here already exist (`src/app/globals.css`, `src/ui`). **The component library at `/library` is where they are shown, documented and tested**: live examples, code, API tables, accessibility notes and the registry. This document says why, and how to use them when something new is needed. Where it describes something not built yet it says so.

## 1. Philosophy

**A home, not a dashboard.** Alice is something a household lives with, used a hundred times a day with one thumb, often in the dark, often by someone who did not set it up. It should feel like a well-made object: warm, calm, quick, and a little playful when you touch it.

Six principles. When two conflict, the lower number wins.

1. **Trust before delight.** Never show a state we have not confirmed. A lock that says "Locked" must be locked. Show the change at once (optimistic), but put it back and say why if Home Assistant does not agree. Dangerous things (unlocking, opening a garage) ask for a passkey and never happen by a stray swipe.
2. **The tile is the control.** The common action (on/off, brighter, more open, faster) happens on the tile, without opening anything. Opening a sheet is for the rare action (a colour, a mode, a preset).
3. **Touch first, thumb first.** Design for a 390 px phone held in one hand. Desktop is the phone layout given room, not a different product. Anything important sits in the lower two thirds of the screen.
4. **Direct manipulation.** Prefer dragging the thing to pressing a button that changes the thing. The control should look like what it controls: a shade you pull, a ring you turn, a wheel of colour.
5. **Quiet by default.** Calm surfaces, one accent at a time, motion only when it explains something. A home at 2 am should not light up the room.
6. **Honest and plain.** Say what happened in everyday words. Never blame the person, never use jargon ("entity", "service call", "capability"). Be explicit about what we cannot do.

## 2. Voice

- Short, warm, concrete. "Back door unlocked" not "Lock state changed to unlocked".
- Name the thing and the result. "Living room lamp on", "Garage door closing…".
- Errors say what is true and what to do: "The garage door didn't respond. It may be out of range." Never "Something went wrong".
- Sentence case everywhere. No exclamation marks, no emoji, no "Oops".
- Say "Alice" for the assistant and the product; never "the system" or "the AI".
- Numbers are tabular and carry their unit (`60%`, `22.5°`, `1,200 W`).

## 3. Visual language

### Colour
A warm paper palette with a sage anchor and a golden glow for "something is on". Dark mode is the same palette in the dark, not an inversion. Use tokens, never raw hex.

| Role | Light / Dark tokens | Use |
|---|---|---|
| Ground | `--bg`, `--tile`, `--tile2` | page, cards and tiles, wells and inactive controls |
| Ink | `--ink`, `--ink2`, `--ink3` | text: primary, secondary, tertiary and hints. All three reach 4.5:1 on every surface they sit on (checked by the library tests with axe). |
| Anchor | `--sage`, `--sage-soft`, `--sage-ink` | primary actions, "calm", success-adjacent. `--sage-ink` is the sage to use for **text on a soft fill** (the plain sage is too light there). |
| Glow | `--glow`, `--glow-soft`, `--glow-ink` | **on / active / live**: lit lamp, filled slider, selected device |
| Warmth | `--clay`, `--clay-soft` | attention that is not an emergency: unlocked, left open |
| On colours | `--on-sage`, `--on-crit` | the text colour on a sage or a crit fill (white in light, dark in dark mode) |
| Status | `--ok`, `--warn`, `--crit` (+ `-soft`) | confirmations, caution, failure |
| Deep | `--deep`, `--deep-ink` | night surfaces |
| Time of day | `[data-tod]` sets `--hero-a/-b` | the Home hero shifts through morning, day, evening, night |

Rules:
- **Glow means on.** Do not use it for decoration. A device tile is glow when its device is active.
- **One accent per surface.** A screen has at most one primary (sage) button.
- **A device may bring its own colour.** A lamp tints its tile with its actual colour; a thermostat tints blue (cool) or amber (heat). Always derive the tile fill from the device colour with `color-mix`, so contrast with the text holds. Never let a device colour set the text colour.
- **Never rely on colour alone.** Pair it with a word, an icon or a shape (warning icon, "Unlocked").
- Contrast: body text 4.5:1, large text and controls 3:1, in both themes.

### Type
Three families, loaded in `layout.tsx`:
- **Bricolage Grotesque** (`--f-display`, condensed `font-stretch: 78–80%`): the brand, page titles and big numbers (`.sbig`, dial values). Tight tracking (`-.03em`). The big number is the hero of a control.
- **Instrument Sans** (`--f-body`): everything else. 15 px body, 12.5 px `small`, weights 500/600/650.
- **JetBrains Mono** (`--f-mono`): codes, ids, badges and timestamps only.

Numbers that change use `font-variant-numeric: tabular-nums` so they do not jitter.

**Text scales (Dynamic Type).** Alice follows the person's text size, and the layout adapts to it, as Apple's does: it does not just get bigger and break.

- **Sizes are `rem`, never `px`.** Browser text size scales them on Android and desktop; on iPhone and iPad the system's size does, through `html{font:-apple-system-body}` (17 px at the default, about 6 % larger than before).
- **Text styles** (`ui/type.css`): Large Title, Title 1 to 3, Headline, Body, Callout, Subhead, Footnote, Caption, as `--fs-*` tokens and `.ts-*` classes. Use these instead of inventing a size.
- **Size tiers** (`lib/text-tier.ts`): `<html data-text>` is `std` (to 115 %), `lg` (to 150 %), `xl` (to 200 %) or `ax` (200 % and up). Layouts that cannot simply wrap change by tier in `ui/tiers.css`: from `lg` three columns become two; from `xl` buttons and segmented controls wrap, rows restack and the top bar drops the words from "Live"; from `ax` device tiles are one column and chips wrap instead of scrolling. Nothing is cut short from `xl` up.
- **Layout pieces that wrap by default** (`ui/layout.css`): `.stack`, `.cluster` (wrapping row), `.autogrid` (columns of at least `--min`), `.clip` (truncates on purpose), `.breaks`. Reach for these before writing a one-off flex or grid. Fixed pixel width and height are for icons, tracks and dials only.
- **Chrome is bounded**: the tab bar labels, the logo, badges and avatar initials grow with text and then stop (`--fs-chrome`), as Apple's tab bar does. Icons and hit targets stay in px; the 44 px target rule still holds.
- **Guardrails:** `npm run lint:css` (also in CI) rejects px font sizes (except as a cap inside `min()`), `nowrap` that is not on the short-label list, and fixed pixel heights on text boxes. `e2e/alice.spec.ts` ("text tiers") opens Home, Rooms, Automate, Admin and a device sheet at 130, 175, 200 and 300 % on a 390 px phone, and fails on sideways scrolling, clipped text, or a wrong tier. `e2e/dynamic-type.spec.ts` covers the component library page. The same check (`e2e/fit.mjs`: sideways scroll, clipped text, squeezed text, wrong tier) runs on a real phone with `e2e/phone-tiers.mjs`, which found a bug the headless runs missed. Screens are also checked with busy data (`e2e/rich.mjs`), and `e2e/compare-with-head.sh` compares a build to another commit pixel by pixel.
- **Adding a screen:** build it from the layout pieces and text styles, then run the tier tests; if something overflows, fix the structure (let it wrap, restack it in `tiers.css`), do not shrink the text.

### Material: the control layer (glass)
Apple's idea, kept restrained: **content is solid; only the layer of controls that floats above it is translucent.** `ui/glass.css` holds it.
- **Where it is used:** the phone tab bar (a floating capsule, inset 12 px from the edges, the selected tab a lighter pill), the Ask button, bottom sheets and dialogs, popovers and menus, toasts (a dark glass card), and the thumb, knob or tile of a control **while it is held** (it lifts and picks up the material).
- **Where it is not:** tiles, cards, rows, forms, text. Never glass on glass: a control inside a sheet is a plain fill.
- **How:** tokens `--glass-bar` (80 % of the tile colour), `--glass-sheet` (90 %), `--glass-dark`, `--glass-hi`, a 20 px blur with a little saturation, a one-pixel light edge and a soft shadow (`.glass` utility). Opacities are high on purpose: text sits on it, and the colour behind must never pull it under 4.5:1 (checked: the tab bar's inactive labels are 4.6 to 4.9:1 in the worst case over the darkest and lightest content; the toast about 8.7:1 or better).
- **Fallbacks:** `prefers-reduced-transparency`, `prefers-contrast: more` and browsers without backdrop blur get solid surfaces, with the same layout.
- **Soft edges, not hard bars:** the page fades into the background under the tab bar and the top bar (a gradient mask), so content melts away instead of ending on a line. The top bar sticks, with its box unchanged (nothing moves).
- **Concentric radii:** an inner shape's radius is its container's radius minus the padding between them (the tab pills are the bar's 26 px minus its 6 px of padding; a phone tile's icon is 18 px minus 10 px).
- **The tab bar shrinks while you read downward** (the other labels fold away, the selected one stays; it returns on the way up) and does not shrink at large text sizes, where labels are needed. The selected tab uses a **filled icon** (`Icon filled`, solid forms in `FILLED` in `ui/icon-paths.ts`); the others stay outlines. Use fill for selected, outline for the rest, as Apple does.
- **Lensing:** on Chromium only (`<html data-lens>`, set by `components/lens.tsx`) the tab bar, the Ask button and toasts bend what is behind them a little at the edges (an SVG displacement filter in the backdrop filter, with less blur so the bend shows). Everywhere else, and for people who ask for less transparency or more contrast, it is the plain glass. It is subtle on purpose.
- **The desktop side rail is a floating glass panel too**, so the chrome is one family.
- **Colour on glass:** sparingly, for the primary action only.

### Shape and depth
- Radius: `--radius` 22 px for tiles and sheets, 16 px for rows and nav items, full pill (99 px) for chips and the Ask bar, 50% for dials and wheels.
- Depth is one soft shadow (`--shadow`) with a faint top highlight, not borders. Inner 1 px `--line` hairlines are for tracks and wells.
- Spacing is a 4/8 grid; 16 px page gutter, 10–12 px between tiles, 14 px inside cards.
- Icons: one set, 24 px grid, 1.7 stroke, round caps (`Icon`). Do not mix in other icon styles.

## 4. Motion

One family of curves, defined once in `:root`. Do not invent new ones.

| Token | Feel | Use |
|---|---|---|
| `--ease-ios` | iOS sheet curve | sheets, sliding thumbs, fills gliding to a new value |
| `--ease-out` | decelerate | things arriving |
| `--ease-in` | accelerate | things leaving |
| `--spring` | light spring, about 3 % overshoot | release, toggles, thumbs lifting |
| `--t-press` .1 s / `--t-release` .5 s / `--t-ui` .3 s / `--t-sheet` .45 s | | |

Rules:
- **Fast in, soft out.** Press feedback is immediate (`--t-press`); release settles on the spring. Bigger surfaces scale less.
- **While a finger is down, nothing animates behind it.** Dragging turns transitions off so the control tracks the finger exactly; the glide comes back on release. (See `.dt.dragging`, `.cshade:active`.)
- **Motion explains.** A shade moves because the cover moves; a fan icon spins because the fan spins. If an animation explains nothing, remove it.
- **Never let layout jump.** Reserve space, hold heights during transitions, no content shifting under a thumb.
- **Reduced motion:** `prefers-reduced-motion` removes movement and keeps short fades. Every animation needs the media-query fallback. Spinning, pulsing and springing are all movement.

## 5. The control grammar (phone)

This is the heart of the design. Every device uses the same four gestures, so a person who has learned one device has learned them all.

| Gesture | Meaning | Rules |
|---|---|---|
| **Tap** | the main on/off or open/close | Instant, with a light haptic. Reversible with the toast's Undo. |
| **Drag sideways on the tile** | set the device's main value | The fill follows the finger; one command is sent on release. Steps of 5 %, haptic tick at 0/25/50/75/100. Dragging to 0 means off. Vertical movement is always left to scrolling. |
| **Hold (about 0.4 s) or the chevron** | open the full controls | Haptic confirms. The chevron is the discoverable twin of the hold; both must exist. |
| **Drag inside the sheet** | fine control | Large targets, live preview, commit on release. |
| **Flick** | a drag released with speed carries on | Lands where the speed would take it (`project`), as a scroll view does. While the finger is down the control follows it exactly. |
| **Swipe across** | choose among neighbours | Segmented controls and tabs: the choice under the finger is selected as it passes. |
| **Double-tap** | back to a default | A slider to its default value, the colour wheel to white. |
| **Scrub** | change a number | Drag a stepper's number sideways: one step every few pixels. |
| **Swipe away** | dismiss | A toast, sideways or down; let go early and it springs back. |
| **Pull past the end** | feel the limit | The control stretches with growing resistance and bumps, then settles back (rubber-banding), instead of hitting a wall. |

Principles for any control:
- **Preview locally, commit once.** While dragging, only the control's own state changes. One command goes out on release, which keeps command history, undo and idempotency clean. Do not send a command per pixel.
- **Dominant axis.** Each device has one main value that the tile drag sets: brightness, position, speed. Everything else lives in the sheet.
- **Reflect real state.** Controls resync from Home Assistant when not being dragged, so a change made on the wall switch shows up. A control being dragged is never overwritten under the finger.
- **Capability driven.** Show a control only if the device can do it. A lamp without colour has no wheel; a fan without presets has no chips. Take ranges and steps (a thermostat's min, max, step; a fan's step) from the device, never hard-code them where the device tells us.
- **Hit targets** are at least 44 px (never under 28); the visible control can be smaller because `ui/touch.css` pads its hit area on touch screens. `e2e/library-targets.spec.ts` measures the real hit area of every control in every example and fails below that.
- **Flicks carry on.** On release a drag control lands where the speed of the flick would take it (`project` in `ui/use-drag.ts`), as a scroll view does; while the finger is down the control follows it exactly.
- **Messages that matter stay.** A warning toast is not removed on a timer: it stays until dismissed (Apple discourages timed dismissal).
- **Reduce Motion** is handled once, at the token level: springs lose their overshoot and long durations shorten, so every component follows.
- **Keyboard and screen readers:** every dial, wheel, strip and shade is `role="slider"` with a label, a value text ("24 degrees") and arrow-key support. A gesture is never the only way to do something.
- **Don't fight the sheet.** Controls inside the bottom sheet set `data-base-ui-swipe-ignore` (the `useDrag` hook does) so dragging a dial never dismisses the sheet.

### Feedback and safety
- **Optimistic, then true.** The tile changes at once. If the command fails, it is put back and a toast says why.
- **Undo, not "Are you sure?"** Reversible actions get a toast with Undo (ten-minute window). Confirmation dialogs are only for things that cannot be undone.
- **Sensitive actions step up.** Unlock, open a garage or gate: a passkey prompt, never skipped, never bypassed by a gesture. Where a stray touch could trigger one, prefer a deliberate gesture (hold, slide) over a drag.
- **Every tap carries an idempotency key.** A retry or a double delivery runs once.
- **Haptics have meanings, not durations** (`ui/haptics.ts`). Components say what happened (`toggleOn`, `select`, `detent`, `boundary`, `hold`, `success`, `warning`) and one place decides what that feels like, how often (ticks cannot repeat faster than every 28 ms, so a fast drag never becomes a buzz), and whether the person wants it (a Haptics switch in the account menu, remembered on the device). On is a touch firmer than off. Reaching an end bumps once. A warning toast is felt as a warning. **A haptic is never the only signal**: many devices cannot vibrate and many people turn it off. Android Chrome vibrates through `navigator.vibrate`; the iPhone path (a hidden `switch` checkbox) is untested; desktop does nothing.
- **Hinting.** Before a long press fires, the tile presses in a little, so the hold is not a surprise; then a firm tap confirms it was recognised.
- **Pointers.** With a mouse or trackpad, controls answer the pointer (a faint veil, a lifted shadow on large tiles) and draggable ones show a grab cursor; none of it runs on touch.

## 6. Device catalogue

What each kind of device gets. "Tile" is the phone tile; "Sheet" is the full controls.

| Device | Tile | Sheet | Status |
|---|---|---|---|
| **Lamp, RGB** | tap on/off; drag brightness; glows in the lamp's own colour | Colour/White switch; colour wheel (angle = hue, distance = saturation); warm-to-cool strip across the lamp's real range; brightness bar; four moods (Candle, Reading, Focus, Movie) | built |
| **Dimmable / tunable white** | same, without the wheel | brightness; strip if it has colour temperature | built |
| **Plain switch, plug** | tap | power now (W) with limit bar | built; history sparkline and off-timer not yet |
| **Cover** (blind, garage, gate, roof) | tap open/close/stop; drag position; "Opening…" state | a window with a shade you pull; Open / Stop / Close | built |
| **Fan** | tap; drag speed; icon spins in step with speed | speed dial (down to 0 = off); oscillation; the unit's presets | built; direction not yet |
| **Thermostat / AC** | tap on/off; tints blue or amber | target dial with the room's temperature marked on the arc; mode switch from the unit's modes | built; fan mode, swing, presets not yet |
| **Lock** | tap (unlock steps up to a passkey); warm warning tone when unlocked | big state, who and when, passkey button | built; slide-to-unlock not yet |
| **Contact / sensor** | read-only state, tap for history | state and "Alice tells you if it stays open" | built (basic) |
| **Camera** | tap opens live view | live view | built (placeholder view) |
| **Media player** | tap power | volume as a vertical drag, play/pause | not built (needs backend operations) |
| **Scene / script** | tap runs; brief "done" | none | built elsewhere (scene cards) |

### Adding a new device type
1. Add its row to this table first (tile, sheet, gestures, what is sensitive).
2. Map it in `live.ts` (`tileType`, `apply`, and any capability metadata) and add `A.*` commands in `store.ts` that follow the optimistic pattern with `sendCommand`.
3. Build the interaction as a presentational component in `src/ui` (no app state), with preview-then-commit, `role`, keyboard and a `/library` demo.
4. Register its sheet in `sheetFor` (`components/device-controls.tsx`).
5. If it needs a tile drag, pass `dragValue` and `onDragCommit` to `DeviceTile`.
6. Log what you could not test in `backend/docs/LIMITATIONS.md`.

## 7. Layout and navigation

- **Four places:** Home, Rooms, Automate, Admin (role-gated). Phone: bottom tab bar. Desktop: left rail. The Ask Alice bar and button are always one tap away.
- **Home** answers "is everything alright?" first (status, alerts, the one scene that fits the time of day), then favourites.
- **Rooms** group by place, with a held-height glide when switching rooms.
- **Bottom sheets** for anything a thumb should reach; **modals** only on desktop or for confirmation.
- **Page changes:** a quick fade out then fade in, never an overlap, and the tab bar, top bar and Ask button never fade.
- **Empty and waiting states** use `Empty` and `Loading` with a short plain line, never a blank screen or a bare spinner.

## 8. Accessibility

- WCAG AA contrast in both themes; verify tints and glows in dark mode.
- Visible `:focus-visible` outline on every interactive element (already global).
- Every control has an accessible name and, for values, a value text with its unit.
- Don't depend on gesture, colour or sound alone.
- Respect `prefers-reduced-motion`, `prefers-color-scheme` and the manual theme override (`data-theme`).
- Touch targets 44 px; keep a 16 px gutter and the safe-area insets.
- Test with the phone's text size increased: layouts reflow, nothing truncates a state ("Unlocked" must always be readable).

## 9. Do and don't

| Do | Don't |
|---|---|
| Put the common action on the tile | Make every change a trip into a sheet |
| Preview while dragging, commit on release | Send a command per pixel |
| Show only what the device can do | Show greyed-out controls for features it lacks |
| Tint with `color-mix` from a device colour | Set text or icon colour from a device colour |
| Use tokens and the motion family | Add hex values or new easing curves |
| Say what happened in plain words | Show codes, ids or "Error" |
| Make dangerous actions deliberate and step-up | Let a swipe unlock a door |
| Give every gesture a keyboard and screen-reader path | Hide a function behind a gesture only |
| Keep one primary button per surface | Fill a screen with accents |
| Keep layout still while things change | Let content jump under the finger |

## 10. Checklist for a new control or screen

- [ ] Works one-handed at 390 px; important actions in the lower two thirds.
- [ ] Tap, drag and hold behave as in section 5; no new gesture without a reason.
- [ ] Optimistic, reverts with a plain-language message on failure, Undo offered.
- [ ] Sensitive action? It steps up and cannot be triggered by accident.
- [ ] Tokens only; correct in light and dark; glow only for "on".
- [ ] Motion uses the shared curves; transitions off during drag; reduced-motion handled.
- [ ] `role`, label, value text, keyboard; target 44 px.
- [ ] Appears in `/library`; the device catalogue and `LIMITATIONS.md` are updated.
- [ ] Checked on a real phone, or the limitation is written down.

## Accessibility testing

The library tests (`e2e/library.spec.ts`) run **axe** (WCAG 2.x A and AA) over every page and every example, in light and dark, and fail on any violation. They are why the hint ink, the warn colour, the danger button in dark mode and the accessible names of the device tiles were corrected. Contrast is a property of the tokens: when a colour is on a tinted or soft surface, check the pair, not the colour.
