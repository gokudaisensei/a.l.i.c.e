# How Apple designs software: a study for Alice

Research notes, read from Apple's own pages in November 2026 (the Human Interface Guidelines' JSON endpoints under `developer.apple.com/tutorials/data/design/human-interface-guidelines/`, and the WWDC transcripts). Each section ends with **For Alice**: what we should take, adapt or leave. Alice's own language is in [`../DESIGN.md`](../DESIGN.md).

**How reliable this is.** Most numbers and rules are verbatim from Apple's pages. Items marked **[summary]** came from a fetch tool's summary of a part of a long page and should be checked before we rely on them. Apple revises these pages often (several changed in 2025 and 2026), so treat numbers as of this date.

**Not found or not readable:** the HIG overview page and the **Haptics** page (both returned errors), so Apple's haptic types are not covered here. The older "clarity, deference, depth" trio did **not** appear on any page we fetched; it is widely quoted from earlier HIG versions but is not in the current text we could read. The Home-app and Control Center *behaviour* (as opposed to the guidelines) comes only from older third-party and support pages and is not covered.

---

## 1. Philosophy

### Current principles (reintroduced June 8, 2026)
Apple's "Design principles" page lists eight. Short paraphrase:

| Principle | Meaning |
|---|---|
| **Purpose** | Make something meaningful; design starts with intention. |
| **Agency** | Let people act their own way, and make recovery from mistakes easy. |
| **Responsibility** | Be transparent about what the product does; protect people's data. |
| **Familiarity** | Build on patterns people know, apply them consistently, give clear feedback. |
| **Flexibility** | Design for everyone; many inputs; keep context across devices. |
| **Simplicity** | "Simplicity isn't minimalism." Establish hierarchy, be concise. |
| **Craft** | Attend to every detail; maintain the product after launch. |
| **Delight** | Know the emotion you want; "don't mistake delight for decoration." |

The Liquid Glass material, introduced June 2025, is described as serving three aims: **hierarchy, harmony and consistency** across devices.

### What shapes the thinking
- **Designing for iOS** describes the device, not a philosophy: a medium, high-resolution display, held in one or two hands about a foot or two from the face, with frequent app switching. Its advice: limit on-screen controls, surface secondary actions with minimal interaction, adapt to orientation, Dark Mode and Dynamic Type, support swipe to go back and row swipe actions.
- **Hierarchy comes from layout and grouping, not decoration** (WWDC25 "Get to know the new design system").
- **Behaviour over animation** (WWDC18 "Designing Fluid Interfaces"): motion is an ongoing conversation between a person and an object, not a fixed curve.

**For Alice.** Our six principles line up well: *trust before delight* is Apple's Responsibility and Agency; *the tile is the control* and *quiet by default* are Simplicity ("limit on-screen controls"); *direct manipulation* is the fluid-interfaces idea. One thing to adopt outright: **Agency means recovery** — our Undo toast already does this; we should extend it (see §6).

---

## 2. Visual language

### Color
- Use colour **consistently**: never the same colour for different meanings (e.g. the brand colour on a non-interactive label), and **sparingly**.
- Supply **light, dark and increased-contrast** variants of every custom colour. Prefer system semantic colours; don't hard-code system values and don't reuse a semantic colour for another role (e.g. a separator colour as text).
- **Never rely on colour alone**: pair with shape or an icon.
- Wide-colour (Display P3) assets with sRGB fallback.
- **On Liquid Glass, apply colour sparingly, mainly to a primary action.** Tinting maps one chosen colour to tones that suit the brightness underneath. Use only for primary actions.
- System colours (for reference, can change by release): red 255,56,60; orange 255,141,40; yellow 255,204,0; green 52,199,89; blue 0,136,255 (light mode) **[summary]**.

### Dark Mode
- **Don't offer an app-only appearance setting**; follow the system. (Alice currently offers a manual `data-theme` override: a deliberate difference, see below.)
- Contrast: at least **4.5:1** for colour pairs; aim for **7:1** for custom colours, especially small text.
- On iOS use the **base and elevated** background colours, so layering stays visible. Soften large white images so they don't glow. Test with Increase Contrast and Reduce Transparency, alone and together.

### Typography
- Use the **built-in text styles** and **Dynamic Type**; keep layouts working at the largest accessibility sizes. At large sizes stack horizontal layouts, reduce columns, and **avoid truncation**.
- **Avoid light weights at small sizes**; prefer Regular, Medium, Semibold, Bold. Minimise typefaces (the page says to limit them; three is a sensible ceiling).
- iOS default and **minimum** sizes: **17 pt body, 11 pt minimum**. Default-size styles **[summary]**: Large Title 34/41, Title 1 28/34, Title 2 22/28, Title 3 20/25, Headline 17/22 semibold, Body 17/22, Callout 16/21, Subhead 15/20, Footnote 13/18, Caption 12/16 and 11/13.
- **Tracking varies with size** (SF Pro **[summary]**: tighter at 13 to 20 pt, looser at 11 pt and 28 pt). Don't use tight leading for three or more lines.
- Text size: let people enlarge text by **at least 200 %** (140 % on watchOS).
- The typeface is **SF Pro** (nine weights, variable optical sizes, four widths, a rounded variant); SF Symbols is the matching icon set.

### Materials and Liquid Glass
- Liquid Glass is **a functional layer for controls and navigation floating above content**. **Don't use it in the content layer.** Exception: transient controls such as sliders and toggles take glass **while activated**.
- Use it **sparingly**; **avoid glass on glass**; never mix the Regular and Clear variants. Regular for anything with text; Clear only over media-rich content, when a dimming layer won't hurt the content, and the foreground is bold and bright. Over bright content add a **35 % dark dimming layer**.
- Its defining property is **lensing**: it bends and concentrates light in real time rather than just blurring. Elements appear by modulating lensing, not by fading. Touch makes the glass flex and light up, and elements can lift into glass temporarily on touch (WWDC25 "Meet Liquid Glass").
- Small glass elements (nav bars, tab bars) flip light and dark with what is behind; large ones (menus, sidebars) adapt without flipping. Larger glass looks thicker (deeper shadow, stronger refraction). Shadows strengthen over text and weaken over light backgrounds.
- Reduce Transparency, Increase Contrast and Reduce Motion modify the glass automatically.
- Standard (non-glass) materials: ultra-thin, thin, regular, thick; **thicker for fine text**. Use vibrant label colours on materials; don't use quaternary vibrancy on thin ones.
- **Scroll edge effects** replace hard separators: a soft fade by default, a hard edge for pinned headers. One per view; don't stack.

### Shape
Three shapes (WWDC25): **fixed** (one radius), **capsule** (radius = half the height), **concentric** (radius = parent radius minus padding, so nested corners stay parallel). Phones favour capsules with extra margin from the screen edge. Custom bars: drop custom backgrounds and borders; group items by function and frequency; give a primary action like Done its own tinted container; don't group an icon with text.

### Icons
One size, level of detail, stroke weight and perspective across the set; match weight to adjacent text; use vector assets; give custom icons text alternatives. SF Symbols: four rendering modes (monochrome, hierarchical, palette, multicolour), nine weights, three scales; **fill variants for selected states and tab bars, outline in toolbars and lists**; animations (bounce, pulse, replace, breathe, rotate…) used only to convey meaning.

**For Alice.**
- **Take:** the discipline of *sparing colour* (glow only for "on", one primary), *contrast* targets (4.5:1 normal, 3:1 large; aim higher for small text), *no truncation* at large text, *no light weights at small sizes*, the concentric-radius rule for nested rounded shapes (a tile's inner chip should have radius = tile radius − padding), and *selected = filled icon, unselected = outline* for our tab bar.
- **Take with care:** **Dynamic Type.** Our type is fixed px. Moving the body to `rem` and testing at 200 % would meet Apple's bar and help older household members. This is the most valuable gap to close.
- **Adapt, don't copy:** Liquid Glass. Its idea (controls float above content, transient controls become glass while held) fits our dials and drag tiles; the *implementation* depends on a GPU material that is hard on the web. A cheap equivalent: while a tile is being dragged, lift it slightly with a stronger shadow (we already scale 1.02).
- **Leave:** SF Pro and SF Symbols (we have our own type and icon voice, and they are licensed for Apple platforms); the "no app-only appearance setting" rule (a household may want a night-time override). Keep our manual theme switch but default to the system.

---

## 3. Motion and fluid interfaces

### Apple's motion guidance (Motion page)
Add motion with **purpose**, never decoration. Make it **optional**; never the only channel for important information (add haptics or audio). Keep feedback motion brief and precise and tied to the gesture. **Generally avoid adding motion to frequent UI interactions.** Let people cancel or skip animations; don't make them wait. The page gives no durations or easing values.

### Reduce Motion (Accessibility page)
Reduce automatic and repetitive animation, including zoom, scale and peripheral motion. **Tighten springs, avoid z-axis depth animation, use fades instead of x/y/z transitions, and avoid animating into or out of blurs.**

### "Designing Fluid Interfaces" (WWDC18)
- **Response**: low latency everywhere, taps included.
- **Redirection and interruption**: any gesture can be redirected or interrupted mid-flight. Pause detection uses finger *acceleration*, not a timer.
- **Spatial consistency**: something that leaves and returns takes symmetric paths.
- **Hinting**: transitions grow out of the initial state towards the final one (Control Center modules).
- **Lightweight input, amplified output**: build a momentum profile from position, velocity and force, then amplify.
- **Rubber-banding**: soft boundaries and smooth hand-offs between tracked objects.
- **Smooth frames**: "it's not just about framerate, it's what's in the frames" (motion blur and stretch help).
- **Springs**: two parameters, **damping** (100 % = no overshoot, 0 % = oscillates forever) and **response** (how fast it reaches the target). Avoid "duration" for elastic motion.
- **[summary]**, check against the session before relying on them: use 100 % damping for smooth motion and add bounce only when the gesture carries momentum (Music uses about 80 % for swipe-to-dismiss); track the finger one-to-one; a swipe begins after about 10 pt of movement; a double-tap recogniser delays single taps by about half a second; **project the landing point** from velocity and deceleration (`(v / 1000) × rate / (1 − rate)`, rate ≈ 0.998 normal, 0.99 fast) and snap to the nearest endpoint.

**For Alice.** Our motion family (`--ease-ios`, `--spring`, fast-in/soft-out) is already close to this thinking. Gaps worth closing, in order of value:
1. **Momentum and projection on release.** When a finger lifts from a dial, tile drag or shade, we commit the exact last value. Apple would carry the velocity: a flick on the blind should continue to open or close fully, a flick on a fan dial should coast. Implement `useDrag` velocity tracking and snap to the nearest detent using the projection formula.
2. **Rubber-banding at the ends** of tile drags and sliders instead of a hard clamp.
3. **Interruptible motion:** a new touch during a glide should take over from the current position (our fills glide with CSS transitions that restart rather than continue).
4. **Reduce Motion:** go beyond "remove movement": tighten springs, swap slides for fades, stop the fan's spin. We remove most, but should audit against Apple's list.
5. **Be sparing with motion on frequent actions.** Apple says not to decorate repeated taps. Our toggles are fine; avoid adding flourish to the tile tap.

---

## 4. Interaction and controls

### Gestures page
- Standard set: tap, swipe, drag, **touch-and-hold to reveal more**, double tap, pinch, rotate.
- **Give more than one way to act.** Custom gestures only when necessary; they must be **discoverable, easy, distinct, and never the only way**. Shortcut gestures supplement standard ones (keep the Back button *and* the edge swipe). Avoid conflicts with system gestures. Show when a gesture is unavailable.
- Accessibility page: use the simplest gesture, avoid custom multi-finger gestures, offer an on-screen alternative to any swipe.

### Controls
- **Hit targets:** default **44×44 pt**, **minimum 28×28 pt**. Spacing around controls about **12 pt** with a bezel, about **24 pt** without. Alice's rule of "44 px" matches the default; note 28 pt is a floor.
- **Toggles:** two opposing states; show state with more than colour. **On iOS the switch style is for list rows only**; outside lists use a button that highlights when on. Default green; change only with enough contrast.
- **Sliders:** minimum at the leading side (bottom when vertical), maximum at trailing (top); fill up to the thumb; **circular sliders only for values that repeat (360°)**, otherwise linear; give **live feedback**; **offer a text field and stepper for exact values**; **don't use a slider for audio volume on iOS** (use the system volume view).
- **Steppers** show no value; pair with a field. **Radio buttons**: two to five options; more → pop-up. **Pickers**: show in context, not in a new view; minute intervals must divide 60.
- **Menus and context menus:** menu labels are verb phrases; hide unavailable items in context menus (dim in menus); one submenu level; about three groups; destructive last, in red. Every context-menu item must also exist in the main UI. Touch-and-hold reveals context menus.
- **Control Center controls** (button or toggle with symbol, title, value): toggles need symbols for both states, animate the transition, tint the on-state symbol; **redact title and value on a locked device**; **require authentication for security-affecting actions** (unlocking a door).

### Alerts, sheets, feedback, undo
- **Alerts** are modal and sparing: title says what happened and why (never "Error" or a code), at most two lines, up to three buttons with one- or two-word verb labels; don't use alerts for information only, for common undoable destructive actions, or at launch; the destructive style only for destructive actions the person *didn't* deliberately choose. Use an **action sheet** (not an alert) for choices tied to an intentional action; cancel at the bottom, destructive at the top.
- **Feedback:** match the significance of the message to its delivery; use **several channels** (colour, text, sound, haptics); put status **next to the item**; **explain why a command can't be carried out**; warn only for unexpected, irreversible loss; confirm significant completions, otherwise report only failure.
- **Undo:** allow **many** undos and don't cap the count; label them ("Undo Typing"); show the result of each undo; offer batch undo.
- **Loading:** show something at once (placeholders), let people keep working, determinate progress when the duration is known.
- Timed auto-dismiss UI is discouraged; prefer dismissal by explicit action (Accessibility page).

### HomeKit (directly relevant)
- Use HomeKit's own terms in the UI: home, room, zone, accessory, scene, automation. **Service names**: no room names (confuses voice), no company or model names, no emoji.
- Use the system setup flow first; don't require an account. **Defer to the Home database**: ask before writing, never overwrite without explicit direction, show conflicts side by side.
- **Cameras: never cover the image.** Show a mic button only if the camera supports two-way audio.
- Demonstrate Siri phrases after setup.

### Widgets and Live Activities
- A widget shows **one clear idea**, is glanceable, not just a launcher; interactivity via tap, buttons and toggles; margins 16 pt (11 pt tighter); text no smaller than 11 pt; animations up to 2 seconds. Live Activities: **at most one interactive element**, only for essential control; **never ads**; end immediately when the event ends; don't duplicate a push notification.

**For Alice.**
- **Take (important):** the **"never the only way"** rule. Our tile drag and dial are gestures; we have keyboard support but not an obvious *visible* alternative on a phone. Add steppers or ± buttons in the sheet for exact values (Apple: "offer a text field and stepper for exact values"). Also add an obvious "less/more" or numeric entry beside the dial.
- **Take:** **Control Center's "authenticate security-affecting actions" and "redact on a locked device"** map to our passkey step-up and to our lock screen widget idea. Also: **"explain why a command can't be carried out"** — our failure toast should always say why, and show "Opening…" while a cover moves.
- **Take:** **undo with no cap and clear labels.** Our Undo is a single ten-minute window; extend to a short history ("Undo garage door close"), and show the restored state.
- **Take:** **status near the item.** Our left-open alerts could also mark the tile itself (a warm warning ring), not only the alert list.
- **Take:** no alerts for undoable actions. We already use toasts with Undo for those; keep confirmation dialogs only for the irreversible.
- **Take:** HomeKit service-naming rules for voice (no room names in device names, no emoji, no brand/model). Worth a hint in the rename dialog and in voice exposure.
- **Take:** use of **vertical sliders with minimum at the bottom** for our blind shade: ours puts closed at the top, which matches a physical blind, but state this convention in the sheet ("Pull down to close").
- **Adapt:** **circular dials only for values that repeat.** Apple reserves circular sliders for 360° quantities and prefers linear for others. Our thermostat and fan dials break that rule. Our reasoning (a dial mirrors the physical thermostat dial and lets a room-temperature marker sit on the same arc) is defensible, but expect it to feel unfamiliar to some people, so the ± buttons above are not optional.
- **Leave:** iOS's rule that toggles are for list rows only. Our tile is a button that highlights when on, which is what Apple prescribes outside lists, and we use switches only in lists and settings. Good match.

---

## 5. Layout and adaptivity

- Most important content **top and leading**; align and indent to show hierarchy; group related items; **progressive disclosure**.
- Use **size classes**, not device type or orientation; keep the same functionality across sizes; **respect safe areas**.
- Extend background content under bars; separate controls from content with scroll edge effects.
- Keep **more of the interface within thumb reach**: middle and bottom controls are easier to hit (Designing for iOS).
- **Tab bar:** a minimising tab bar on scroll down; a dedicated Search tab. Sidebars are inset glass.
- **Going full screen:** don't exit automatically; keep essential controls; the Home indicator auto-hides and one swipe exits.

**For Alice.** Our phone-first layout, bottom tab bar and bottom sheets already follow this. Take: **a tab bar that minimises on scroll** to give the device grid more room, and **safe-area handling** audited on notched phones (we use `env(safe-area-inset-*)` for the sides; check the bottom Home-indicator inset for the tab bar and sheets).

---

## 6. Accessibility

- Text enlargement to 200 %; defaults and minimums above; **contrast AA** (4.5:1 up to 17 pt, 3:1 from 18 pt or bold); provide a higher-contrast scheme under Increase Contrast; check light and dark.
- Support **VoiceOver, Voice Control, Switch Control and Full Keyboard Access**; don't override system shortcuts.
- Don't rely on colour; pair audio with haptics and add visual cues; avoid timed auto-dismiss; avoid autoplay.
- Reduce Motion as in §3; **Dim Flashing Lights**.

**For Alice.** We cover AA contrast, focus rings, `role="slider"` with value text, keyboard arrows, and `prefers-reduced-motion`. **Gaps:** Dynamic Type and 200 % text, an Increase Contrast mode (`prefers-contrast: more`), **timed toast dismissal** (Apple discourages timed dismissal; ours auto-dismisses after a countdown, with a pause on touch; add a way to keep it, and make sure undo remains reachable elsewhere), and a **Voice Control** check (every control needs a visible, speakable name).

---

## 7. Writing and tone

- Be clear, use fewer words, **read it aloud**; plain language, no jargon, no gendered terms.
- **Verb-based button labels**; "tap", not "click"; descriptive link text.
- Pick **title case or sentence case per element type** and apply it everywhere.
- Use possessives sparingly ("Favorites", not "Your Favorites"); **avoid "we" in error messages**.
- **Errors sit next to the problem, don't blame, say how to fix it:** "Choose a password with at least 8 characters", not "That password is too short". No "oops".
- Empty states give a clear next step; settings labels describe what the setting does when on.
- Purpose strings for permissions: one sentence, sentence case, active voice, ends with a full stop. A pre-permission screen has one button ("Continue"), no cancel, never mimics the system alert.
- Account deletion must be possible in-app if accounts can be created there; prefer **passkeys**; name the method on the button.

**For Alice.** Our voice rules (sentence case, plain, no "oops", say what and what to do) already agree. Take: **avoid "your"** where a plain noun works ("Favourites"); **verb labels** on every button; **pre-permission screens** for push and notifications (our push switch should explain first, then trigger the browser prompt, and ask only when the person reaches that feature). Also take: **account deletion** (our admin screens should offer a real deletion path, not just removal).

---

## 8. Onboarding, data entry, privacy

- Onboarding: fast, optional, after launch; **teach by interactivity**; prefer **contextual tips** near the relevant UI over one long flow; don't repeat a skipped tutorial but keep it findable.
- Ask for permissions **when the feature is first used**, not at launch, unless the app cannot work without them. Never offer incentives for tracking.
- Entering data: **collect as little as possible**; sensible defaults; validate as people type; disable Continue until required fields are filled; secure entry for secrets; never prefill passwords.
- Require an account only when core functionality needs it; delay sign-in.

**For Alice.** Our first-run flow (passkey, recovery codes, connect Home Assistant) is necessary setup, so it is fine, but we can still: **defer** push and phone linking until the person reaches them, and add **contextual tips** (for example, a one-time hint on the first lamp tile: "Drag sideways to dim. Hold for colour.") instead of a tutorial. This also answers Apple's point that a gesture must be *discoverable*.

---

## 9. What Alice should do next, ranked

| # | Change | Why (Apple source) | Size |
|---|---|---|---|
| 1 | **Visible alternatives to every gesture:** ± buttons or numeric entry in the thermostat, fan, lamp and cover sheets | "Never the only way"; steppers for exact values | small |
| 2 | **One-time contextual hints** for drag and hold on first use | Gestures must be discoverable; contextual tips | small |
| 3 | ~~**Dynamic Type:** `rem`-based type, test at 200 % and AX sizes, no truncation of state~~ done in runs 33 and 34 (rem sizes, size tiers, wrapping layouts, lint and a screen-by-tier test) | Typography and Accessibility pages | medium |
| 4 | **Momentum, projection and rubber-banding** in `useDrag` and the tile drag | Fluid Interfaces | medium |
| 5 | **Longer undo:** a short history with named entries | Undo and redo | medium (backend has a ten-minute single undo) |
| 6 | **Status next to the item:** warn ring on a tile that is open or unlocked | Feedback | small |
| 7 | **Increase Contrast mode** and a Reduce Motion audit (tighten springs, fades not slides, stop the fan spin) | Accessibility | small |
| 8 | **Toasts that don't depend on a timer** (keep or reopen) | Accessibility: avoid timed dismissal | small |
| 9 | **Concentric radii** on nested shapes, selected = filled icon | Liquid Glass shape rules, SF Symbols | small |
| 10 | **Naming guidance for voice** in rename and voice-exposure UI | HomeKit | small |
| 11 | **Pre-permission screens** for push | Privacy | small |

Not recommended: copying Liquid Glass wholesale, adopting SF fonts or symbols, or removing the manual theme override.

---

## Sources (all Apple, read November 2026)
- Human Interface Guidelines (JSON form): color, typography, motion, materials, layout, accessibility, dark-mode, icons, sf-symbols, writing, gestures, toggles, sliders, steppers, pickers, color-wells, sheets, alerts, action-sheets, context-menus, menus, controls, feedback, undo-and-redo, loading, onboarding, entering-data, managing-accounts, privacy, home-screen-quick-actions, widgets, live-activities, homekit, designing-for-ios, design-principles, going-full-screen, drag-and-drop, pointing-devices, game-controls: `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<name>.json`
- Technology overviews: Liquid Glass and Adopting Liquid Glass (`developer.apple.com/documentation/TechnologyOverviews/`)
- WWDC25: [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/), [Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/)
- WWDC18: [Designing Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/)
- [Design: What's new](https://developer.apple.com/design/whats-new/)
- Secondary, background only: Nathan Gitter, ["Building Fluid Interfaces"](https://medium.com/@nathangitter/building-fluid-interfaces-ios-swift-9732bb934bf5) (an independent write-up of the WWDC18 talk, with sample code).
