# Android design bible

Status: **ratified, revised 2026-11-11** (phone-only, mock-data phase). Companion to
`android/docs/architecture.md`: that doc says *how* the app is built; this one says *how it looks
and feels*. Every new screen is reviewed against §10 before it merges.

How to read this document. Rules say **must** or **never**. Anything the code does not yet do is
listed in **§13 Open issues** with an ID (D1, D2, …) instead of being described as if it were
true. Numbers in the tables were checked against the code on the revision date; if code and bible
disagree, fix whichever is wrong in the same PR. The 2026-11-11 revision corrected the hold timing,
press depths, level-setting rules, popup behaviour, colour meanings, touch targets, haptics rule and
component table, and added §12 (screen archetypes), §13 (open issues) and §14 (verification).

Scope: the native Android client in `android/`. It targets the **phone layout only** and mirrors
the web frontend's *visual language* while re-authoring the *interaction model* for a phone in
the hand (see §4 and the comparison notes in the conversation). No desktop/tablet layout, no "Ask
Alice" palette/FAB, no theme toggle for now.

---

## 0. Psychology & rationale

This section is the *why* behind every rule in §§1–11. Read it before designing a new screen:
the rules are not aesthetic preferences, they are consequences of how a person holds a phone,
how their thumb moves, how their nervous system reads motion, and how trust is built or lost in
a home-control app. **The single most important influence on this app is iOS.** Every animation
curve, haptic, spring, safe-area inset, tap target, and sheet behaviour borrows from iOS's Human
Interface Guidelines and from the feel of first-party Apple apps. Android is the platform; iOS is
the reference for *feel*. When the two conflict, iOS feel wins unless it breaks a platform
contract.

### 0.1 The emotional contract

Alice controls a home. A home is intimate, high-stakes, and shared. The app must feel:

- **Calm, not clever.** No spinners, no "AI is thinking" theatrics, no confetti. The loudest
  moment on any screen is the hero gradient, and even that is a time-of-day sky, not a
  billboard.
- **Competent, not busy.** One glance should answer "is everything fine?" (`needsAttention`,
  the chips, the status line). If nothing needs attention, the screen says so plainly
  ("Everything is calm.") and gets out of the way.
- **Trustworthy.** State is shown, not inferred. Locks say who locked them and when. Energy says
  kW, not a vague "high". Commands are optimistic but reconciled from real backend state, and
  every one is undoable within ten minutes.
- **Warm, not cold.** Sage greens, warm clay, amber glow. No pure black/white except as ink.
  Shadows are warm (`rgba(44,38,24,.45)`), never grey.

The web's own comment captures it: *"Colour is held back for meaning."* That is a psychological
choice, not a styling one — colour that means something is colour you can trust; colour that
decorates is colour you learn to ignore.

### 0.2 Borrowed from iOS (and why)

| iOS principle | How Alice implements it | Where |
|---|---|---|
| **Springs, not tweens, for release** | `Motion.release()` is a spring with ~3% overshoot that settles in ~0.5s. Releases feel *physical* — a thing that was pushed and came back. Tweens feel mechanical. | `Motion.kt`, `Pressable` |
| **Press-in as a hint** | A finger down scales the surface to `depth` (0.90–0.98, see §0.3) in 100ms with `easeOut`; the surface is *already* responding before the action fires. A holdable surface sinks slower (310ms) and deeper (0.955), then breathes. This is Apple's "hinting" — the user feels the affordance before committing. | `Surface.kt` `rememberPress`, `breatheOnHold` |
| **Direct manipulation** | Level controls track finger *movement* one to one (never finger *position*, §4.3). The fill follows the finger exactly; the value never jumps on touch-down and never carries on after release. | `DeviceTile`, `LevelScrub` |
| **Rubber-banding at limits** | Past an end, a tile stretches with growing resistance (it approaches ≈22dp; see D8 for the px/dp slip) and springs back. The limit is *felt*, not announced. | `DeviceTile` (`stretch`) |
| **Haptic language** | Distinct shapes for distinct events (tick vs detent vs boundary vs success). iOS's Taptic Engine philosophy: haptics carry *information*, not decoration. | `Haptics.kt` |
| **Differentiated on/off** | Toggle-on is firmer than toggle-off so the two directions feel different. A person learns the difference in their hand. | `Haptic.ToggleOn/Off` |
| **Safe areas** | `statusBarsPadding()` on the hero, `navigationBarsPadding()` on the tab bar/toast. Content never hides behind system chrome. | `HomeScreen.kt` |
| **Generous targets** | The Android contract is **48dp** (not iOS's 44pt) and it wins over iOS feel: every tappable must have a ≥48dp hit area even when the visual is smaller (steppers are 40dp, discs 32–40dp, folded tabs 44dp; today only the visuals are that size, see D7). | `Stepper.kt`, `GlassTabBar.kt` |
| **Container transform in, fade out** | The web uses a bottom sheet. Android's popup *grows out of the tile you held* (a container transform) and leaves with a plain fade, so it looks the same for a tile in any column (§4.5). Drag-down-to-dismiss is preserved. | `DevicePopup.kt` |
| **Reduce Motion** | The system "remove animations" setting is meant to switch motion to short fades. Today only the launch screen does (D6). | `ReduceMotion.kt`, `LoadingScreen.kt` |
| **Dynamic Type** | `sp` sizes scale with the user's font size. (Web goes further with iOS Dynamic Type via rem; Android matches the spirit.) | `Type.kt` |
| **No hover** | No hover states anywhere. Everything is touch-first. | all components |
| **Bottom-aligned primary actions** | Tab bar, toast and the hero's scene button are all thumb-reachable. Destructive/primary actions sit at the bottom of their surface. | `HomeScreen.kt` |

The iOS influence is deliberate and must be preserved even as Android-specific features (widgets,
quick settings tiles, notifications) are added later: those surfaces should feel like Alice, i.e.
like iOS-translated-to-Android, not like Material defaults.

### 0.3 Interactivity: fine-tuning and why

Small numbers with large effects. These are the values that make the app feel "right"; treat them
as constants, not suggestions. All were checked against the code on 2026-11-11.

| Value | Why |
|---|---|
| Press depth: icon buttons and steppers `0.90`, chips and pills `0.94`–`0.96`, cards and rows `0.97`–`0.98` (default `Pressable` is `0.97`) | Deeper = smaller control. A stepper is a nudge; a card is a commitment; the scale communicates weight. |
| Press duration 100ms (`Motion.PRESS_MS`) | Fast enough to feel instant, slow enough to register as a response. Web's `--t-press` is the same. |
| Release spring damping 0.72 / stiffness 200 | ~3% overshoot, settles in ~0.5s. Overshoot says "the surface is elastic, not a button"; no overshoot feels dead. |
| Hold threshold = the **system** long-press timeout (≈400ms, `viewConfiguration.longPressTimeoutMillis`) | It follows the user's accessibility setting. `Motion.HOLD_MS` (430) exists but nothing uses it: delete or use it (D9). |
| Hold hint 310ms (`Motion.HOLD_HINT_MS`); breath ticks at 90 / 120 / 110ms, then a detent | The surface presses in, then three ticks of increasing certainty, then a stronger detent, so the hold "arms" before it fires. The ticks finish at ≈320ms, just before the ≈400ms hold. |
| Breath scale 0.955 → 0.968 ↔ 0.952 (430ms each way) | A visible but gentle swell. Too deep looks broken; too shallow is invisible. |
| **Tile drag: full range = 220dp of finger travel; it starts after 2× touch slop (≈16dp)** | Gentle enough that a small slip is a small change. The larger start threshold means a finger that wobbles during a hold stays a *hold*, not a drag. |
| **Popup bar and hold-slide: full range = the bar's width (≈320dp on a 411dp phone), one to one** | The fill follows the finger exactly. |
| **Settle zone 12dp after a hold** | A finger that has just held a tile always drifts a little; the first 12dp of movement must not change the level (D1). |
| Rubber band approaches ≈22dp | Matches iOS scroll rubber-banding proportions. |
| Detent every 5, quarter at 25 | 5 is "a step"; 25 is "a quarter of the range": both are natural anchors. |
| Tick rate limit 28ms | Above this, a fast drag becomes a buzz; below it, ticks blur together. Measured on real hardware. |
| Popup open: spring (damping 0.74, stiffness 230). Close: 220ms ease-in fade, settling to 0.96 | In: a thing that grows from what you touched and settles. Out: it leaves where it is. |
| Toast 2600ms | Long enough to read a short sentence, short enough not to block the next action. |
| Toast entrance scale 0.9→1 + slide from half height | A thing arriving from above, settling: reads as "a message landed", not "a popup appeared". |
| Tab fold threshold 8px of scroll (px, not dp: D8) | Small enough to trigger on a real read, large enough to ignore jitter. |
| Tab wave delay 45ms per tab | A ripple that follows the pill; fast enough to feel like one gesture, slow enough to be seen. |
| Hero status-bar padding + 32dp bottom radius | The hero owns the top of the screen; the rounded bottom says "this is a sky, not a card". |

### 0.4 Animation as information, not decoration

- **Motion carries state.** The mode pill slides to show which mode is active. The level fill rises to
  show the level. The tab pill glides to show where you are. If an animation does not communicate
  state, it should not exist.
- **Entrances orient.** The splash → hero handover and the `brandAlpha` fade tell the user "you
  arrived somewhere". No staggered tile entrances (the web has them; Android drops them) because
  on a phone a stagger reads as lag, not polish.
- **No flash on command.** The web flashes a tile when a command targets it. Android does not:
  the optimistic state change *is* the feedback, and a flash would compete with it.
- **Reduce motion is a first-class path**, not an afterthought. Every animated screen checks
  `rememberReduceMotion()` and falls back to short fades. A screen that animates without that check
  does not pass review.

### 0.5 Haptics as a language

- Haptics are **semantic verbs**, not durations. A screen says *what happened*; `Haptics` decides
  the feel and the 28ms rate limit. This keeps meaning consistent across screens and lets the
  platform tune the feel (Android `VibrationEffect` predefined effects vs. the web's raw pulses).
- **On and off feel different** (ToggleOn firmer than ToggleOff). Direction matters in the hand.
- **Errors and warnings have shape**, not just length: `Warning` is a double pulse, `Error` is a
  triple. A person learns to flinch at `Error` without looking.
- **Success is a confirmation**, not a celebration: `CONFIRM` effect, one beat. No buzz of triumph.
- **Ticks are rate-limited** so a fast drag becomes a texture, not a buzz. This is the difference
  between "I'm scrubbing a value" and "my phone is broken".

### 0.6 Gesture ergonomics

- **Thumb zone.** Primary actions (tab bar, toast, hero scene button, lock-all) sit in the bottom
  third of the screen. Destructive and rare actions sit higher or behind a hold.
- **Two axes, on purpose (§4.3).** A *tile* is set by a vertical drag: a thumb moving up/down is
  more controlled than side-to-side on a tall phone held in one hand, and the fill rising from the
  bottom is the natural mapping (up = more). The *popup's bar* and the *hold-then-slide* are
  horizontal, because a wide bar reads left to right ("more" is further along) and the finger that
  opened the popup is already at the side of the screen.
- **Movement, never position.** A level is changed by how far a finger *moves*, never by where it
  touched. Touching must not change a value.
- **Hold to open, tap to toggle.** The same surface does two things by duration, not by target.
  This keeps the tile clean (no chevron) and rewards learning.
- **Drag-down-to-close** on the popup. The card follows the finger down; past 220px, or on
  release, it fades out where it is.
- **Tap outside to dismiss.** Always. No "X" as the only exit except inside the card itself.

### 0.7 Colour psychology

- **Sage = calm/ok/selected.** The colour of "nothing to do". Used for the selected mode pill,
  presets, "Switch", success.
- **Glow (amber) = on, and "look at this".** A lit tile glows; an unlit tile does not. The same
  amber family also carries attention: the alert banner is `glowSoft` with a `glow` disc, and an
  unlocked door is `warn` amber on the dark `deep` card. Shape and place tell the two apart (a
  tile versus a banner), so do not use `glow` for anything else. The hero wordmark's full stop is
  glow: the one spark of energy on a calm screen.
- **Clay = warmth.** The climate tile only. It is the colour of heat, not of alarm: do not use it
  for warnings.
- **Crit = error only.** Reserved (destructive actions, failures). If everything is red, nothing is.
- **Ok = confirmation text** ("Home" under a person). Small, never a fill.
- **Deep = doors/locks.** A dark, serious surface for the one thing people check before leaving
  home. The contrast signals "this matters".

### 0.8 Copy & tone

- Short, concrete, second-person-light. "Doors locked", "1 unlocked", "Caught up", "Movie night
  started".
- No exclamation marks. No "Oops". No "Something went wrong" without a next step.
- Empty states are sentences with a verb: "Star a device in Rooms to pin it here."
- Toasts name the action that happened, in past tense: "Front door locked", not "Locking…".

### 0.9 Trust & safety

- **Optimistic but reconciled.** A tap updates the UI immediately and the backend confirms or
  rolls back. The user never waits for a round trip to see their action land.
- **Undo within ten minutes.** Every command carries an undo. (Surfaced in the UI as the toast's
  undo action — to be added when the command lifecycle lands; the contract is already shaped for
  it.)
- **Passkey for unlock, never for lock.** Unlocking is the dangerous direction; locking is free.
  The asymmetry is intentional and matches the web. **Rule:** a lock is never toggled by a plain
  tap or by a popup button anywhere in the app: locking is one tap, unlocking goes through the
  passkey confirmation. *Today the Rooms tile and the device popup unlock with one tap (D2).*
- **Role-gated UI.** Guest sees less; admin sees more. The server closes sockets on revocation
  within 2s. The UI never trusts the client's role alone.

### 0.10 Performance as psychology

- Instant feedback beats fast feedback. `StateFlow` + Compose means a tap recomposes only the
  affected composable; there is no "bump the whole tree" like the web's `bump()`. The result is
  that taps feel immediate even on a mid-range phone.
- No loading spinners for data that is already cached. The mock (and later Room) returns
  synchronously on cold start; the splash covers only the first frame.
- Animations are 60fps-targeted via Compose's animation system, not CSS transitions on the main
  thread.

### 0.11 What we deliberately did *not* borrow

- **No Material You / dynamic colour.** The palette is Alice's, fixed. Dynamic colour would
  dissolve the identity.
- **No bottom sheets for device controls.** The morphing card keeps the *content* of the web's
  sheet but in a shape that grows from the tile — more legible on a phone, and it preserves the
  "I touched this tile" spatial link.
- **No iOS navigation bar / large titles.** Alice has no navigation stack of screens in the
  conventional sense; the tab bar is the navigator.
- **No swipe-to-delete, no pull-to-dismiss on cards.** Too easy to trigger by accident on a
  home-control surface.

---

## 1. Purpose & scope


- One product, two clients. The Android app must read as the same Alice as `frontend/`: same
  palette, type, colour semantics, iconography, haptics vocabulary. A person moving between web
  and phone should never feel a seam in the *look*.
- The *feel* is native. Gestures, motion curves, and control surfaces are re-authored for touch
  (§4). We do not chase web parity of interaction; we chase web parity of *intent*.
- Phone only. No responsive breakpoints, no tablet/desktop layouts, no hover states.
- Mock data is still the source (`data/mock`). The bible is about presentation; it does not
  change the data contract in `architecture.md`.

## 2. Visual language

### 2.1 Colour (`ui/theme/Theme.kt`)

Colour is **held back for meaning**. The hero is the one bold moment; everything else is quiet.

| Token | Meaning | Typical use |
|---|---|---|
| `bg` | page background | screen background |
| `tile` / `tile2` | neutral card / recessed | default card, icon disc when off |
| `ink` / `ink2` / `ink3` | primary / secondary / tertiary text | — |
| `sage` / `sageSoft` / `onSage` | calm, ok, selected | mode selected, lock-all, success |
| `glow` / `glowSoft` / `glowInk` | on, lit; also "look at this" on a banner | device on, level fill, hero wordmark dot, alert banner |
| `clay` / `claySoft` | warmth | climate tile |
| `ok` | confirmation text | "Home" under a person |
| `warn` / `warnSoft` | attention on a dark surface | unlocked door tile on `deep` |
| `crit` | error | destructive actions, failures |
| `deep` / `deepInk` / `deepInk2` | dark surface | locks/doors card |
| `over` | translucent overlay | steppers, glass tint base |
| `line` | hairline border | dividers |

Rules:

- **Do not introduce a new accent colour.** If something needs emphasis, borrow `glow` (active)
  or `sage` (selected/ok). Two accents already cover every state.
- `glowSoft` means "this device is on" (or, on a banner, "look at this"); `claySoft` means "this is
  the climate surface"; `sageSoft` means "this is the calm/selected surface". Pick by meaning, not
  by taste.
- Dark mode is system-driven only (`isSystemInDarkTheme()`). No in-app toggle, no persistence,
  for now. Both themes are first-class: every screen is checked in light and dark (§14). Known:
  the hero is dark at night even in the light theme, so its status-bar icons need a light tint
  then (D10).
- The hero gradient shifts with time of day (`hero()` in `HomeScreen.kt`). Every other surface
  uses the static palette.

### 2.2 Typography (`ui/theme/Type.kt`)

Three fonts, each a role. Never a raw `sp` outside `AliceType`.

| Role | Font | Use |
|---|---|---|
| `brand` | Bricolage 800, 78% width, 40opsz | "alice." wordmark only |
| `hero` | Bricolage 760, 86% width, 48opsz | hero greeting |
| `heroSub` | Bricolage 340, 100% width, 24opsz | hero status line |
| `section` | Bricolage 650, 90% width, 30opsz | section headings |
| `big` | Bricolage 720, 85% width, 72opsz | big numbers (kW, temp) |
| `body` / `bodyStrong` | Instrument Sans 400/600 | body copy, device names |
| `small` | Instrument Sans 400, 12.5sp | subtitles, hints |
| `label` | Instrument Sans 600, 12sp | chips, tabs, buttons |
| `mono` | JetBrains Mono 500, 12sp | numbers in lists, time, kW |

Rules:

- Variable axes are part of the identity. Reproduce them via `FontVariation` (as in `Type.kt`);
  do not substitute a static weight.
- Numbers that change use `big` or `mono` with tabular figures. Labels are 12sp Instrument 600.
- `AliceTypography` maps these onto Material3 so any Material component inherits the family.

### 2.3 Shape (`ui/components/Surface.kt`, `Glass.kt`)

| Token | Value | Use |
|---|---|---|
| `TileShape` | 22dp rounded | every card |
| hero bottom | 32dp rounded | hero only |
| tab bar | 26dp rounded | glass tab bar |
| discs / pills / steppers | `CircleShape` | icon discs, chips, +/- |
| sheets / popups | 32dp rounded | morphing popup, bottom sheets |

Rules:

- A card is 22dp. If a surface needs to feel different, change its **colour**, not its radius.
- `CircleShape` is reserved for things you press with a fingertip (discs, pills, steppers) or
  capsules (toast, chips). Never for cards.

### 2.4 Spacing

| Context | Value |
|---|---|
| Page horizontal padding | 16dp |
| Between cards (LazyColumn) | 14dp |
| Inside bento grid | 10dp |
| Tile padding | 12–16dp |
| Section header | the heading text is inset 4dp *inside* the page padding, so it sits at 20dp from the screen edge, aligned with a card's content; the header itself must be wrapped in the 16dp page padding (D4) |
| Device tile | 116dp tall, 3 per row, 10dp gaps |
| Hero padding | 20dp sides, 20dp top, 22dp bottom |

Rules:

- Use the ladder. If a value is not on it, justify it in the PR (the homescreen's 92dp popup
  margin is one such justified exception: 24dp card margin + 22dp card padding on each side, which
  is what makes the popup bar's width about screen width minus 92dp).
- Everything that lines up must line up: headings, cards and rows share the 16dp page padding.
- `Bento` handles column counts (2 under 600dp, 4 above) and `IntrinsicSize.Min` row heights;
  do not hand-roll grids.

## 3. Motion & haptics

### 3.1 Motion (`ui/Motion.kt`)

One family of curves. No bespoke easings.

| Name | Value | Use |
|---|---|---|
| `easeOut` | cubic-bezier(.22,1,.36,1) | presses, UI, entrances |
| `easeIos` | cubic-bezier(.32,.72,0,1) | sheets, popups |
| `easeIn` | cubic-bezier(.4,0,1,1) | exits |
| `release()` | spring, damping 0.72, stiffness 200 | release, pill slide, tab slide (~3% overshoot) |
| `press(ms)` | tween, easeOut | press-in (default 100ms) |
| `ui(ms)` | tween, easeOut | UI transitions (default 220ms) |

Durations: press 100ms, release spring, UI 220ms, sheet/popup 220ms.

Rules:

- Compose motion from `Motion.*`. Do not declare a new `CubicBezierEasing` or spring in a
  screen.
- Reduce motion is meant to be respected via `rememberReduceMotion()` (system "remove
  animations"): an animated screen checks it and falls back to short fades (see `LoadingScreen.kt`,
  the only place that does today: D6).
- `Motion.HOLD_MS` is unused (the system long-press timeout is used); remove it or use it (D9).

### 3.2 Haptics (`ui/Haptics.kt`)

Screens say what happened; `Haptics` decides the feel. Semantic verbs only:

`Tick, Detent, Select, ToggleOn, ToggleOff, Light, Medium, Heavy, Boundary, Hold, Success, Warning, Error`.

Rules:

- Never call the vibrator directly. Never vibrate without a named reason.
- Every `Pressable` plays its haptic on click (a plain `Light` unless it names another). Drags tick
  at 5-step boundaries, detent at quarters, bump at ends. A hold plays `Hold`, and whatever opens
  the popup adds `Medium`.
- Android API gating: `SEGMENT_FREQUENT_TICK`, `SEGMENT_TICK`, `TOGGLE_ON` and `TOGGLE_OFF` are
  API 34+; older phones fall back to `CLOCK_TICK`, `CONFIRM` and `VIRTUAL_KEY`. An emulator plays
  none of them, so haptics are only ever verified on a phone (§14).
- Ticks and detents are rate-limited to 28ms so a fast drag does not become a buzz.
- Haptics are on by default; no in-app toggle for now.

## 4. Interaction grammar (the refined part)

These are the idioms the homescreen established and that new screens must reuse.

### 4.1 Press

Every tappable surface is a `Pressable` (`ui/components/Surface.kt`). It scales to `depth`
(0.94–0.98) under the finger and springs back on release, playing its haptic. Plain `clickable`
is reserved for non-interactive layers (the dim behind a popup, a card's container when an inner
row is the real target).

### 4.2 Hold → breathe

Long-press surfaces use `breatheOnHold`: the tile presses in, then breathes (0.968 ↔ 0.952) with
haptic ticks ramping up (90ms, 120ms, 110ms → detent), so the hold is never a surprise. The
hold threshold is the system long-press timeout (≈400ms). Hold opens the device console (§4.5).

### 4.3 Setting a level (two gestures, one idea)

A level is always set by finger **movement**, never by finger **position**: a touch that does not
move never changes a value, and every gesture starts by remembering the current level and measuring
from there. Two gestures exist, on two axes, by design (§0.6):

| | Tile drag | Popup bar and hold-then-slide |
|---|---|---|
| Axis | vertical, up raises | horizontal, right raises |
| Fill | rises from the bottom | grows from the left |
| Full range | 220dp of finger travel | the bar's width (about screen − 92dp), one to one |
| Starts | after 2× touch slop (≈16dp) | popup bar: the normal drag slop. Hold-slide: after a 12dp settle zone |
| Resolution | steps of 5 | whole numbers (haptic steps of 5) |
| Ends | lands exactly where the finger leaves it | live: nothing to land |

Common rules:

- Ticks every 5, detents at quarters (0/25/50/75/100), a `Boundary` bump the first time an end is
  reached; ticks are rate-limited to 28ms.
- Rubber band (tile only): stretches with resistance past either end, approaching ≈22dp, with the
  `Boundary` bump on first crossing; springs back on release.
- **No flick carry-on.** It was in the web's behaviour and was removed: it overshot.
- `LevelScrub` is the one implementation of the horizontal gesture. It is shared by the popup's bar
  and by hold-then-slide, so they feel identical. A finger that has just held a tile always drifts,
  so a hold-slide must start with the 12dp settle zone (D1: not in the code today).
- **Hold-then-slide.** The finger that opened the popup stays attached to the tile's gesture and
  keeps reporting movement. Sliding it left or right changes the level live in the popup until it
  lifts; the popup stays open afterwards. Holding still must change nothing.
- A dimmable tile consumes vertical drags that start on it, so the page cannot be scrolled by
  starting a swipe on one. Locks, plugs, cameras and sensors have no drag (D11).

Acceptance numbers (emulator, 1080×2400 at 420dpi; distances in real pixels; a level is a
percentage). A change must still pass these:

| Test | Expected |
|---|---|
| Hold a tile with a shaky finger (a few px of wobble), no real movement | popup opens, level unchanged |
| Hold, then slide 200px right | about +20 |
| Fresh drag of 60px starting at the left end of the popup bar | about +4 to +5, no jump |
| Steady 200px tile drag up | about +27 to +30 (one step of 5 either way) |
| Fast 100px tile flick down | about −10, no overshoot |

### 4.4 Toast

`GlassToast` (`ui/components/GlassToast.kt`): a dark glass pill that springs in above the tab bar
(fade + scale 0.9→1 + slide), auto-dismisses at 2600ms, and keeps the last message on screen
while it animates out. Toasts are one-off effects declared in `UiState` and cleared by
`DismissToast` — never fired from inside a composable. Today it is one line of text: no undo
action, no countdown line and no swipe-to-dismiss (the web toast has all three: D14).

### 4.5 Device console (the popup)

**Decision (ratified): full richness, in a card that grows out of its tile.** The popup is not a
level setter; it is the device's full console, ported from the web's bottom sheet into a shape that
belongs to a phone.

Shape and motion (as built):

- **Opens** by growing from the held tile's bounds on a spring (`morph`), with the page behind it
  dimmed and blurred (`presence`, up to 36px of blur). The contents fade in once the card has
  mostly grown (after 35% of the morph) so they are never squashed.
- **Closes by fading in place** (`presence` 1→0 over 220ms ease-in, the card settling to 0.96). It
  does *not* shrink back into the tile: a tile in a side column would pull the card off-centre
  and break the screen's symmetry. The morph runs only on open.
- Close with: tap outside, Back, the close button, or drag the card down (it follows the finger;
  past 220px, or on release, it fades).
- The card is 32dp rounded, `tile` colour, 24dp side margins, 22dp padding, contents spaced 18dp.
- The popup owns no data: it is stateless over a `Device` plus callbacks.

Contents are chosen by the device's **capabilities**, not its kind:

| Capability | Built today | Target, not yet built |
|---|---|---|
| `brightness` (light) | big %, horizontal bar, presets (Off/25/50/75/Max), mood buttons if colour-capable, colour-temperature text | colour wheel and white strip, −/+ nudges, last-value hint when off (D13) |
| `fan_speed` | bar, presets, oscillation toggle, Low/Medium/High | a speed dial option |
| `target_temperature` (climate) | `Dial` with a room-temperature marker, mode segmented control | −/+ nudges; the marker is a fixed 26.4° in the mock |
| `position` (cover) | big %, `CoverShade`, Open/Stop/Close | — |
| `power` (plug) | `PowerButton` with watts | power-limit bar with a 90% warning |
| `lock` | one toggle button (unsafe: D2) | state, passkey to unlock, one-tap lock |
| anything else | the icon, the state, the kind | per-kind content |
| **any screen that passes them** | footer chips under a hairline: **Favourite**, **Voice** (admin only, never a lock or camera), **Hide** (admin only; hides and closes) | **Rename** (needs a text field, D3); Home does not pass the footer yet |

Rules: a new capability gets a row in this table before it gets code; controls come from the
component vocabulary (§6); the popup must not scroll on a phone (if the content would not fit it
needs a different layout, not a scroll view).

### 4.6 Tab bar

`GlassTabBar`: a floating glass pill (26dp, 12dp side margins, 10dp above the navigation bar) with
a glass pill that slides under the selected tab on the release spring, outlined icons that turn
filled when selected, labels that fold away while reading downward (the selected tab keeps its
label) and return on the way up, and a tiny lift "wave" (2.5dp, 45ms per tab) that travels between
the old and new selection while folded. It does not fold at font scale 1.3 or more, where labels
are needed. Four tabs: Home, Rooms, Automate, People (the web's fourth is Admin: revisit when
roles land).

The glass is the same everywhere (`GlassSurface`): the content behind it is blurred (14dp),
saturated (1.5) and, on Android 13+, bent a little at its edges like a lens; Android 12 gets the
blur only; older phones get a nearly solid tint so text keeps its contrast. It is tinted, has a
light 1dp edge and a soft shadow.

### 4.7 Empty & attention states

- `AlertBanner` (glow-soft strip with "Got it") when `HouseholdState.needsAttention`.
- Phrasing is calm and concrete: "Doors locked", "All locked", "Caught up", "1 unlocked". No
  exclamation marks, no "No data."
- Empty states are sentences: "Star a device in Rooms to pin it here."

## 5. Layout blueprint

Every phone screen follows this skeleton:

```
Box(fillMaxSize, bg)
  Box(fillMaxSize, blur behind popup)
    Box(fillMaxSize, recordBackdrop, nestedScroll)
      PullToRefreshBox(refreshing, onRefresh)
        LazyColumn(contentPadding = bottom 130dp + navBars, spacedBy 14dp)
          item { Hero(...) }                       // full-bleed, statusBarsPadding
          alert?.let { item { AlertBanner(...) } }
          item { ModeTile(...) }                   // or screen-specific primary tile
          item { SectionHeader("…", "hint") }
          items(...) { ... }                      // bento rows / device rows
          ...
      soft gradient fade (130dp) at bottom
    GlassTabBar(backdrop, tab, onSelect, minimized = minimized && !big)
    GlassToast(toast, onDismiss, bottom 104dp + navBars)
  popup?.let { dim + morphing card }
```

Rules:

- Hero is always first and full-bleed (status-bar padding, 32dp bottom radius).
- `contentPadding` bottom is `130dp + navigationBars` so content clears the bar.
- The 130dp gradient fade at the bottom makes content melt into the bar instead of ending on a line.
- Tab bar and toast are overlaid, not in the scroll content.
- Safe areas: `statusBarsPadding()` on the hero, `navigationBarsPadding()` on tab bar and toast.
- **The skeleton has two hero sizes, one sky.** *Glance* screens (Home) use the full hero: wordmark,
  greeting, status line, chips and a primary action. *Catalogue* screens (Rooms, Automate, Admin)
  use a **compact hero**: the same wordmark row (with the screen's icon buttons beside it), the
  title, one short *live* status line ("8 of 11 active") and one chip row; no explanation and no
  primary button (§12). Every hero takes its gradient, ink and chip fill from `hero()` (time of
  day, light and dark), so changing tabs never changes the colour or drops the brand: a pale or
  neutral hero on one tab reads as "something is missing". A compact hero is about 80% of Home's
  height.
- Everything between the hero and the first content row is chrome. On a catalogue screen it must
  be small enough that the first item is visible without scrolling (§12).

## 6. Component vocabulary

Use these; do not reinvent them. All live in `ui/components/` unless noted. Checked against the
code on 2026-11-11.

| Component | File | When to use |
|---|---|---|
| `Tile`, `Pressable`, `TileShape`, `rememberPress`, `breatheOnHold` | `Surface.kt` | any card; any tappable surface; the one 22dp radius; the press and hold motion |
| `AliceWordmark` | `Brand.kt` | hero (and splash) only |
| `hero()` | `HeroPalette.kt` | the hero's time-of-day colours (gradient top, bottom, ink, chip fill); every hero uses it |
| `IconDisc` | `IconDisc.kt` | icon in a circle (36dp by default, icon 55%; `spin` turns it: a running fan) |
| `IconChip`, `FilterChip`, `PresetChip` | `Chips.kt` | hero status chips; room/voice filters with a count; level presets |
| `IconButtonCircle`, `PillButton` | `Buttons.kt` | close/dismiss discs; small capsule actions ("Switch", "Got it") |
| `Stepper` | `Stepper.kt` | −/+ at a range end (`atLimit` plays the bump) |
| `Segmented`, `Modifier.slidingPill` | `Segmented.kt`, `SlidingPill.kt` | one-of-many choice with a sliding selection |
| `SearchField` | `SearchField.kt` | search input |
| `ListRow` | `ListRow.kt` | disc + title/subtitle + trailing (activity, hidden devices, sheet headers); `titleMaxLines` lets a name take two lines |
| `DeviceRow` | `DeviceRow.kt` | a device as a full-width row on catalogue screens: disc, name, state, then a `Toggle` (light, fan, plug, cover, climate) or a chevron (lock, camera, sensor: a tap never switches those). Tap opens the popup, which grows out of the row |
| `Toggle` | `Toggle.kt` | an on/off switch: 52×32dp glow track, thumb on the release spring, 56×48dp touch target |
| `SectionHeader` | `SectionHeader.kt` | title + optional hint above a group; it carries the page padding itself (20dp = 16 + a 4dp optical inset), so callers add none. With `onToggle` it is a collapse control: a chevron (down open, right closed, on the release spring), 48dp tall, `Select` haptic, "Expanded/Collapsed" announced; the hint stays visible while closed, and an optional `peek` (a `PeekStack`) shows only while closed |
| `PeekStack`, `Peek` | `PeekStack.kt` | overlapping preview discs (an icon or a monogram) for what a folded group holds, "+N" past four |
| `AccordionList`, `AccordionPane` | `AccordionList.kt` | a list whose drag turns a position and opens/closes its categories in proportion (§12 rule 5). Give it panes (key, title, hint, peek, content); it owns the position, the settling fling, the sizing and the nested scrolling |
| `Bento` | `Bento.kt` | even grid of cards (2 cols under 600dp, 4 above; rows as tall as their tallest card) |
| `DeviceTile` | `DeviceTile.kt` | a glanceable device (Glance screens, favourites): tap, vertical drag, hold-then-slide (§4.3) |
| `LockTile` | `LockTile.kt` | a door on the `deep` surface (never toggles by tap: §0.9) |
| `SceneCard` | `SceneCard.kt` | scene or routine; fixed parts so a row is always one height; "Suggested" is a corner tag |
| `Dial`, `CoverShade` | `Dial.kt`, `CoverShade.kt` | climate target; cover position (popup only) |
| `Sparkline` | `Sparkline.kt` | bare line chart |
| `LevelScrub` | `LevelScrub.kt` | the horizontal level gesture with its haptics (§4.3) |
| `AlertBanner` | `AlertBanner.kt` | warm warning strip with acknowledgement |
| `GlassSurface`, `Modifier.recordBackdrop` | `Glass.kt` | any floating glass |
| `GlassTabBar` | `GlassTabBar.kt` | bottom navigation |
| `GlassToast` | `GlassToast.kt` | transient message above the tab bar |
| `LoadingLine` | `LoadingLine.kt` | thin progress line (splash, loading) |
| `rememberReduceMotion` | `ReduceMotion.kt` | the reduced-motion switch (§0.4) |

Rules:

- A new component is added only when none of the above fits, and it is added to this table in the
  same PR.
- Components take only what they draw + callbacks. No `ViewModel`, no repository, no whole
  `HouseholdState`. A plain domain model such as `Device` is fine: it carries no Compose types.
- A gesture component may play the haptic for its *own* gesture (a press, a drag step). It never
  plays one for an *outcome* it cannot know (a command succeeding or failing): that comes from
  state or an event.

## 7. State & data contract (design-relevant)

From `architecture.md`, the parts that shape the UI:

- A screen is `XScreen(state, onEvent)` + `internal XContent(state, onEvent, …)` + `XViewModel` +
  `XUiState` + `XEvent`. `XContent` is `@Preview`able with a fixture.
- Shared data in `HouseholdState` (repository); screen state in the VM; geometry/animators/refresh
  spinner in the composable.
- Derived values (`kw`, `unlockedCount`, `homeCount`, `newActivityCount`, `needsAttention`) are
  computed once in `HouseholdState`.
- One-off effects (toast) are fields in `UiState`, cleared by an event.
- Icons travel as string keys (`"sun"`, `"moon"`, …) and are mapped in a per-screen `*Icons.kt`.

## 8. Icon & copy conventions

- Domain carries icon **keys**, never `ImageVector`. The UI maps them (`HomeIcons.kt`).
- Tone of voice: calm, concrete, second person avoided in labels. "Doors locked", not "All doors
  are locked!". "Caught up", not "No new activity."
- Empty states are sentences. Attention states name the thing ("1 unlocked", "Water heater at
  92% of its power limit").
- Toasts name the action that happened: "Movie night started", "Front door locked".

## 9. Do / don't

**Do**

- Use `Alice.c.*` and `AliceType.*`. Use `TileShape`, `Motion.*`, `Haptic.*`.
- Make every screen's `Content` `internal` and `@Preview`able with a `UiState` fixture.
- Put derived values in `HouseholdState`.
- Use `Pressable` for tappables, `Tile` for cards, `IconDisc` for icon-in-circle.
- Respect `rememberReduceMotion()` (D6).
- Set levels from movement, with the settle zone after a hold (§4.3).
- Give every tappable a ≥48dp hit area (D7).
- Say state in words as well as colour ("Locked", "Home", "Closed").
- Check a screen in light and dark, at font scale 1.3, before calling it done (§14).

**Don't**

- Don't introduce a new colour, radius, or motion curve without a reason documented in the PR.
- Don't pass a `ViewModel` or repository into a component.
- Don't pass a whole `HouseholdState` into a component; pass the fields it draws.
- Don't use `clickable` for interactive surfaces.
- Don't put Compose types in `domain/model`.
- Don't let a screen play haptics or toasts for *outcomes* (a command worked or failed); that comes
  from state or an event. A gesture component playing the haptic for its own gesture is fine.
- Don't map a touch position to a level, ever.
- Don't toggle a lock from a tap, a drag or a popup button; unlock needs the passkey (§0.9).
- Don't leave empty cells in a grid: a group of one or two items is a row, not a tile (§12).
- Don't shrink the popup back into its tile on close: it fades (§4.5).
- Don't add hover states or desktop layouts.

## 10. New screen checklist (the gate)

A screen is not done until all of these hold:

- [ ] Package `ui/<name>/` with `XScreen`, `XViewModel`, `XUiState`, `XEvent`, and (if icons
      differ) `XIcons`.
- [ ] `XContent(state, onEvent, …)` is `internal` and has a `@Preview` using a fixture.
- [ ] Uses the §5 skeleton (hero, attention, sections, fade, tab bar, toast).
- [ ] All tappables are `Pressable`; all cards are `Tile`; all icons in `IconDisc`.
- [ ] No new colours/radii/curves; haptics via named verbs.
- [ ] Derived values live in `HouseholdState`; screen state in `XUiState`/VM; geometry in the
      composable.
- [ ] Reduce-motion fallback present for any animation.
- [ ] Empty and attention states follow §4.7 / §8 copy.
- [ ] Declares its archetype (Glance or Catalogue) and meets §12.
- [ ] Headings, cards and rows line up on the 16dp page padding.
- [ ] Every tappable has a ≥48dp hit area; state is never colour alone.
- [ ] Locks never toggle from a tap; unlock goes through the passkey (§0.9).
- [ ] Any level gesture passes the §4.3 acceptance numbers; no flick carry-on; no jump on touch.
- [ ] Checked on the emulator in light and dark and at font scale 1.3; haptics checked on a phone (§14).
- [ ] §13 updated: anything the screen does not yet do is an open issue with an ID, not a surprise.
- [ ] Builds: `./gradlew :app:assembleDebug :app:compileReleaseKotlin`.

## 11. Reference: homescreen anatomy (`ui/home/HomeScreen.kt`)

The homescreen is the canonical instance of every Glance-screen rule above (it is *not* the model for Catalogue screens: see §12 and the Rooms anatomy below). When in doubt, read it:

- Full-bleed hero with wordmark, time-of-day gradient, chips, full-width scene `Pressable`.
- `AlertBanner` when `needsAttention`.
- `ModeTile` with `slidingPill` + suggestion row.
- 3-up device rows with `DeviceTile` (vertical drag, breathe-on-hold, hold-then-slide, a popup that grows out of the tile and fades out).
- `DoorsTile` on the `deep` surface with `LockTile`s and "Lock everything".
- `Bento` for scenes (2/4 cols).
- Climate + energy side by side.
- `PeopleRow`, `ActivityTile` (accordion, "new since you were away").
- `GlassTabBar` with fold-on-scroll; `GlassToast` above it; 130dp fade.

### Reference: Rooms anatomy (`ui/rooms/RoomsScreen.kt`), the model for Catalogue screens

- **Layout**: the hero, the (closed) search and view panels and the list area are a fixed column: nothing scrolls except inside the list area (§12 rule 5).
- **Compact hero**: Home's time-of-day sky and `alice.` wordmark, a search button and a view button on the wordmark row (translucent chip colour; the open one turns ink), the `Rooms` title, a live status line ("8 of 11 active") and a row of counts. About 80% of Home's hero; the first group header sits about 39% down the screen. Light and dark both use `hero()`.
- **Search and view are closed by default.** The search button opens a field (closing it clears it, so a hidden filter never keeps narrowing the list); the view button opens a panel with By room / By type, a "Then by brand" chip (type grouping only) and, for admins, the Voice filter, whose disclaimer appears only while the filter is on. There is no chip bar: the first group header follows the hero directly. A glow dot on the view button says the panel is hiding a non-default choice.
- **One card per group** (room or type) with a header (`1 of 2 active`, a chevron, a peek stack while closed) and a `DeviceRow` per device, hairlines between rows (inset past the disc). Dragging in the list opens one and closes the neighbour, tapping a header jumps to it; the Hidden section is the last category; searching shows everything in a plain list.
- **Empty state** is a sentence plus a "Clear filters" action when a filter is on.
- **Hidden devices** (admin) as rows with "Show again".
- The popup carries the management footer (§4.5). Same skeleton as Home otherwise: fade, glass tab bar, toast, pull to refresh.

---

### Reference: Automate anatomy (`ui/automate/AutomateScreen.kt`), a Catalogue screen
The hero is the sentence. Browsing: hero + counts, an `AccordionList` of Automations / Scenes / Routines (rows: icon disc, name, plain-English sentence up to 3 lines, last run, trailing toggle or Run). Building: the hero turns into a `SentenceFlow` ("When [x] if [y] then [a] and [b]"); each chip is a slot, and tapping one swaps the panel below (`BuilderEditors`); the tab bar is replaced by a bar with Save / Dry run / Delete. New components: `SentenceFlow`, `ValueStepper`. Rule: unlock is never offered as an action; the panel says only a passkey opens a door.

### Reference: People anatomy (`ui/people/PeopleScreen.kt`), a Catalogue screen
A person is a card of what they may do. Browsing: hero ("2 of 4 at home") and an `AccordionList` of Household (avatar with a presence dot AND the words Home/Away, role pill), Invite someone, Sign-in. Opening a member turns the hero into their card (large avatar, name, status); the panel holds the role (Admin/Member/Guest, with what that role may do in plain words), a Devices panel (a switch per device grouped by room, All / None; Admins have all) and a bar replaces the tab bar. Remove asks first and needs the passkey tap; your own role and removal are not offered. Invites are a one-time code shown once (Copy), pending ones listed with Revoke. No passwords exist, so Sign-in is one note and one button.

### Reference: Settings anatomy (`ui/settings/SettingsScreen.kt`), a Catalogue screen that is not a tab
Settings is the blind behind the sky: tap the gear at the top right of any hero and the sky settles over the page (a plain 300 ms fade); a drag up on it, the Close button or Back lets it go. The gear is hidden while a card or builder is open. The bottom bar is about the home, Settings is about the house, so it has no tab. `SettingsButton` opens it through `LocalOpenSettings` (set in `MainActivity` around the tabs; nowhere else, so it draws nothing there). Inside: a verdict hero ("Everything is working" / "2 things need a look") and an `AccordionList` of Backups, Health, Updates, Support access, Your alerts. Anything that changes what the house keeps or who gets in (restore, delete, install, grant support) asks for the passkey in one card at the bottom (`Confirm` in the state).

### Arranging the Favourites (Home, `DeviceGrid`, `ResizeFrame`)
The favourites are a responsive grid: columns follow the width (about 104dp a cell, 3 on a phone up to 6), a cell is nearly square, and cards are packed in order into the first free spot and glide to place with a spring. A card is **1×1** normally, **1 wide by 2 tall**, or **2×2** (two columns always means two rows). Way in: pull the "Favourites" title down like a drawer (the cards loosen: they shrink a hair and their outlines fade in; a tick marks the line; let go to arrange), or tap "Arrange". Pulling up is left to the page. While arranging the rest of the page dims, every card has an outline, tap one to select it, and drag its dots the way it should grow (or back the way it should shrink): bottom edge, right edge, corner; only the dots that lead to a valid size are shown. It snaps a cell once the finger is a third of the way there, with a tick. "Done" or Back leaves; "Reset layout" returns everything to 1×1. The dots are small, filled, and centred on the outline's stroke; the frame reaches 10dp past the card so a dot can be grabbed from just outside it. A card that touches the right edge of the screen is widened from its left edge (left dot and bottom-left corner) and, if it would run off the edge, moves one place earlier in the order to make room. A handle being dragged stays alive even when the card's new size would not offer it. Columns: 3 below 568dp wide (any phone, however large its display size is set), 4 up to 800dp, 6 beyond. The sizes are kept in `HomeUiState.sizes` (survives rotation, not a restart: D27).

## 12. Screen archetypes

Pick one before designing a screen. They share the skeleton (§5) but not the density.

**Glance (Home).** Answers "is everything fine?" and offers the few things people do most. Full
hero; tiles and bento cards; favourites three across. Density is low on purpose: every item is
something you would tap without reading.

**Catalogue / manage (Rooms, Automate, Admin).** Answers "where is X, and let me change it".
Built for finding and managing many items. Rules:

1. **Content first.** A compact hero (same sky and wordmark as Home, §5). The first item is
   visible without scrolling on a 411×915dp phone: everything above it (the chrome) takes at most
   about 40% of the height (Rooms: about 39%).
2. **One control row, in the hero.** A search icon (opens a field when tapped) and a view icon
   (opens a panel) beside the wordmark; nothing else sits between the hero and the first group.
   Grouping and rare filters (Voice) live in the view panel, not in permanent rows, and there are
   no filter chips for the grouping itself: choosing "By room" or "By type" already says it. No
   permanent explanatory paragraph: explain a filter when it is switched on.
3. **Rows, not sparse grids.** An item is a full-width row: disc, name (up to two lines, never
   truncated), state, and a trailing control (a switch, or a chevron to the popup). A three-across
   tile grid with one or two items leaves empty cells and truncates names. Tiles, with drag and
   hold-slide, belong to Glance screens and favourites. Tapping a row's disc/name opens the popup.
4. **Management lives in the popup.** Favourite, voice (admin), hide and rename sit in the popup
   footer (§4.5), not in extra routes. Every action a view model offers must be reachable from the
   UI; an event with no way to trigger it is a bug.
5. **The list area scrolls the categories, not the page.** On a Catalogue screen the hero and the controls are fixed; only the list area below them reacts to a drag, and a drag there does not move anything: it opens and closes categories.
   - **One number, the position.** 0 is the first category, 1 the second, and so on. A drag changes it (120dp of finger travel per category, settled by hand on the phone); each category is open in proportion to how close the position is to it (`1 - |position - i|`). Between two categories one is therefore closing exactly as the other opens, in step with the finger, with the chevrons turning and the peek stacks fading with it. On release it settles on the nearest category, or the next one if flicked; a header tap jumps to it.
   - **An open category always shows its full height; a tall one is read to its end first.** There is no cap and no inner scroll window (an earlier version capped the open card and scrolled rows inside it, which cut off long categories and the By-brand view). If the open category is taller than the area, a drag first scrolls the whole list until the end of that category is in view (going back: until its start is), and only the movement left over turns the position. So a long category is read to its end before the next one opens, and going back up arrives at the previous one at its end. A category that fits never scrolls: it hands the drag straight on. A flick inside a tall category carries on (decaying momentum) and stops at its start or end; a second drag, or a flick from the edge, moves on from there.
   - **Nothing slides under the finger**, because no item's place depends on a scroll offset: this replaced a page-scroll version that tracked a "reading line" and re-pinned the page, and was janky and fiddly.
   - **Header sizing.** Headers shrink from 44dp towards 34dp (below the 48dp target: D7) so that, with many categories, about 200dp is still left for the open one; a category taller than what is left scrolls as above.
   - **Search turns the accordion off:** while a query is typed every result is shown, in a plain scrolling list, so a match is never hidden inside a closed category. The focus (the settled category) is kept in the screen state and returns after a rotation.
   - **Peek stack.** A closed header shows a small overlapping stack of discs previewing its contents (`PeekStack`: the kinds of device in a room, the brand initials in a type), with "+N" past four.
   - The cost: a Catalogue screen has no pull-to-refresh and the tab bar does not fold (there is no page scroll to drive them).
6. **Grouping.** *By room* (rooms A to Z) or *By type* (Lights, Climate, Fans, Blinds & covers, Plugs, Locks, Cameras, Sensors, most used first). Within a type there is an optional second level, **Then by brand**, that splits the card into brand sub-sections (a monogram, the name in mono capitals, a count), A to Z. A new grouping starts over on the first category. There is no "by hardware" any more: type is what a person is looking for; the brand is a refinement.
7. Locks follow §0.9 everywhere.

## 13. Open issues

Places where the code does not yet meet this document. Fix the code, or change the rule here with
a reason; do not leave them unnumbered.

| ID | Issue | Where | Weight |
|---|---|---|---|
| D1 | `LevelScrub` has no settle zone, so a held finger's drift changes the level (this was fixed once and the fix is gone) | `LevelScrub.kt` | high: causes unwanted changes |
| D2 | The popup's lock button unlocks with one tap and no passkey. (Rooms rows no longer toggle a lock: a lock row opens the popup.) | `DevicePopup.kt` | high: security rule |
| D3 | Rename is not built (needs a text field). Favourite, voice and hide are in the popup footer, but only Rooms passes them; Home does not | `DevicePopup.kt`, `HomeScreen.kt` | medium |
| D6 | Only the launch screen honours reduced motion; Home and Rooms animate regardless | all screens | medium: accessibility |
| D7 | Touch targets under 48dp (steppers 40dp, discs, folded tabs 44dp) with no larger hit area | `Stepper.kt`, `IconDisc.kt`, `GlassTabBar.kt` | medium: accessibility |
| D8 | Constants written in px that should be dp: the rubber band (22×3 px), the tab fold threshold (8px) | `DeviceTile.kt`, `HomeScreen.kt` | low |
| D9 | `Motion.HOLD_MS` is unused | `Motion.kt` | low |
| D10 | Status-bar icons do not follow the hero (dark hero at night in the light theme); content scrolls under the status bar with no scrim | hero, all screens | low |
| D11 | Dimmable tiles capture vertical drags, so the page cannot be scrolled by starting on one. Option: arm the drag only after a short hold | `DeviceTile.kt` | low: a trade-off |
| D12 | Stale comment: `DeviceTile`'s KDoc says "a flick carries on" (it lands exactly) | `DeviceTile.kt` | low |
| D13 | The popup lacks nudges, colour wheel and strip, power-limit bar and last-value hint (§4.5) | `DevicePopup.kt` | medium |
| D14 | The toast has no undo, countdown or swipe-to-dismiss | `GlassToast.kt` | low |
| D15 | **Glass cost, measured on the phone (Motorola edge 50 pro, 120 Hz) and, for comparison, on the emulator.** Phone, medians of 3 passes of 12 swipes: with the glass the median frame is 9 to 10 ms against 8 ms without (+1 to 2 ms), the 90th percentile 16 to 17 ms against 14 to 15 ms, GPU time 5 ms against 4 ms (about +1 ms a frame). Janky-frame percentages did not follow the glass (Rooms 4.2% with it, 5.2% without; Home swung from 5.6% to 12.8% between two identical runs), so they are noise at this size. Recording the backdrop costs nothing measurable; the blur is the whole cost; the lens shader adds nothing measurable. The emulator (a software GPU) exaggerated it about tenfold (+12 ms). Verdict: on a phone of this class the glass is cheap enough to keep as it is. Options if a weaker phone ever needs them, in order: (1) freeze while scrolling (flat tint during a drag or fling, blur fades back in about 150ms later); (2) a cheaper blur (radius 14dp to 8dp, or a half-resolution copy); (3) adaptive quality: drop to the flat tint when the screen's own jank crosses a threshold (JankStats) or in power-saver. Not measured on a low-end phone | `Glass.kt` | low |
| D16 | Opening the Rooms search does not focus the field or raise the keyboard; one more tap is needed | `SearchField.kt` | low |
| D17 | *Resolved: closed categories cost one header line, so one-device rooms no longer make the page long.* | | |
| D18 | The mock shows "Aiming for 0°" for the living-room climate device (target 0 in the mock data) | `MockAliceRepository.kt` | low |
| D19 | Which category was settled on is not remembered after the app restarts (it lives in the view model; it does survive rotation) | `RoomsViewModel.kt` | low |
| D20 | *Retired: the page-scroll accordion (reading line, pinning, debounce) was removed. Still to judge on a phone: the settle spring, the flick thresholds, the momentum inside a tall category* | `AccordionList.kt` | low |
| D23 | Rooms has no pull-to-refresh and the tab bar does not fold, because the page no longer scrolls. Refresh needs another gesture or a button | `RoomsScreen.kt` | low |
| D24 | With nine categories the headers shrink to about 34dp, under the 48dp target (D7); and with By type + By brand the last two headers sit below the first screen of the open category until it is scrolled to its end | `AccordionList.kt` | low |
| D22 | *Resolved: measured on the phone (D15). Home and Rooms scroll within about 2 ms of each other, and the glass is not what separated them on the emulator.* | | |
| D21 | A single-brand type shows one brand label above all its devices, which is noise; skip the sub-section header when there is only one brand | `RoomsScreen.kt` | low |

Resolved on 2026-11-11 (kept here so the history is visible): **D4** (`SectionHeader` now carries the page padding; Home and Rooms look the same), **D5** (Rooms redesigned to §12: compact hero, one filter bar, rows, nothing truncated).

- **D25** People: a person has no id (the name is used) and the passkey step on Remove and "Add a passkey" is not wired to the backend; two members with one name would clash. Guest expiry cannot be edited. The Home Assistant person link (web) is not offered.

- **D26** Settings: the passkey step is a single tap with the mock; Restore does nothing but toast; the audit log ("who did what"), emergency deploy, backup destination (NAS) and encryption, quiet-hour times, and rollback of an update are in the web app and not here yet; dark theme and large text not checked.

- **D27** Home arranging: sizes are not saved to the backend or device storage; cards cannot be reordered by dragging (only resized); not checked in dark theme, at font scale 1.3 or in landscape.

## 14. Verification protocol

How a screen is checked before it merges.

- **Devices.** The emulator (AVD `alice_test`: Pixel 6, Android 15, x86_64, with KVM) for
  everything except haptics. A real phone for haptics, for the performance of the glass, and for
  how a gesture *feels*. An emulator plays no haptics.
- **Targeting.** Always `adb -s <serial>`. Before sending any touch or key, confirm the focused
  window is Alice: `adb shell dumpsys window | grep mCurrentFocus` must show `com.alice.home`. A
  test once injected touches into another app. Never send input to a phone someone is using.
- **Each screen:** light and dark; font scale 1.0 and 1.3; one pass with animations removed; screenshots at
  the top, the middle and the end of the scroll; the popup opened and closed from a left, a middle
  and a right tile (the fade must look the same for all three).
- **Gestures:** the §4.3 acceptance table, driven with `adb shell input motionevent DOWN/MOVE/UP`
  (for hold-then-slide) and `input swipe` (for drags).
- **Build gate:** `./gradlew :app:assembleDebug :app:compileReleaseKotlin`.

---

Ratified against: the vertical tile drag, the horizontal popup bar and hold-then-slide (always
relative to the finger's movement), full device-console richness in a popup that grows out of its
tile and fades out, phone-only, no "Ask Alice" for now. Changes to any of those require a bible
revision.
