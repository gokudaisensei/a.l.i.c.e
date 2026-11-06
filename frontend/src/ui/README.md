# Alice UI

Presentational components for the Alice Home design. Import everything from `@/ui`.

**Rules**
- Nothing here imports from `@/lib` or reads app state. Behaviour comes in through props.
- Styling lives in one stylesheet per component beside it (see "Where the styles live" below); design tokens stay in `src/app/globals.css`.
- App-specific wrappers that know about devices live in `src/components/device-controls.tsx`.
- Browse every component at `/library`.

| Group | Components |
|---|---|
| Actions | `Button`, `IconButton`, `StepButton` |
| Status | `Pill`, `Chip`, `FilterChip`, `Eyebrow` |
| Inputs | `Switch`, `Slider`, `Segmented`, `OptionGroup`, `OptionButton`, `Field`, `FieldRow`, `Input`, `Textarea`, `Select`, `Stepper`, `TimeField` |
| Layout | `Tile`, `TileHeader`, `Grid`, `AccordionContext`, `PageHeader`, `Tabs` |
| Data | `Bar`, `Avatar`, `IconTile`, `Empty`, `Safe`, `Notice`, `KeyValue`, `Steps`, `Table`, `Sparkline`, `Html` |
| Builders | `ActionRow` |
| Overlays | `Modal`, `BottomSheet`, `ConfirmDialog`, `Toast` |
| Icons | `Icon` (24px grid, 1.7 stroke) |

`Tile` staggers its entrance by render order: call `resetTileOrder()` at the top of a view.
`Tile` becomes a phone accordion when wrapped in `AccordionContext.Provider`; you own the open state.
`Html` is for trusted in-app strings only.

## Motion and behaviour

- **One motion family** lives in `:root` of `globals.css`: `--ease-ios` (sheets), `--ease-out`, `--ease-in`, `--spring` (a light spring made with `linear()`), and the durations `--t-press`, `--t-release`, `--t-sheet`. Use these instead of writing new curves.
- **Press feedback**: fast on the way in (`--t-press`), a soft spring on the way out (`--t-release`). Bigger surfaces scale less (`--press`).
- **Overlays** are built on Base UI: `Modal` (dialog, top or centre), `BottomSheet` (drag or flick down to dismiss) and `ConfirmDialog`. They trap focus, return it on close, close on Escape and on a tap outside, and animate out as well as in. Put `data-base-ui-swipe-ignore` on any child that needs its own drag; `Slider` already does.
- **`Switch`** and **`Slider`** are Base UI parts, so state is exposed as `data-checked`, `data-dragging` and `data-disabled`. The switch thumb stretches while pressed; the slider fill glides when a value jumps.
- **`Segmented`** is a radiogroup with a sliding thumb and arrow-key navigation.
- **`Button`** uses `cva`; `buttonVariants({ variant, size })` gives the class string for links or other elements. Variants: default, primary, sage, danger, ghost. Sizes: sm, md, lg.
- Components set `data-slot` (and `data-variant` on `Button`) so they can be targeted from outside.
- `prefers-reduced-motion` removes movement but keeps short fades.

## Where the styles live

Each component has its own stylesheet beside it (`button.css`, `badge.css`, `fields.css`, `segmented.css`, `switch.css`, `slider.css`, `data-display.css`, `tile.css`, `chart.css`, `overlay.css`). `styles.css` imports them all and is loaded in `app/layout.tsx` **before** `globals.css`, so a screen can override a component at equal specificity.

What stays in `globals.css`: design tokens, the reset, the app shell, the screens, and rules that depend on context (`.hero .btn`, `.pg3 .dt`). The shared press-feedback block also stays there because it spans several components.

## Added later

- **`Select`** replaces the native drop-down: a styled popup with type-ahead and arrow keys, built on Base UI. `options` is `[value, label][]`. The old native `Select` wrapper is gone.
- **`Tooltip`** (wrap an icon button; hover and keyboard focus only), **`Popover`** (anchored panel, `PopoverClose` to dismiss), **`Checkbox`** (with children it becomes a 44px row; supports `indeterminate`) and **`Progress`**. `Bar` is now a thin wrapper over `Progress`, so every meter exposes `role="progressbar"` and its fill glides.
- **Phone tiles**: `DeviceTile` (tap to toggle, hold or chevron for more; the long-press logic lives in the component), `AddTile`, `ModeButton`, `SceneCard`, `LockTile`.
- Floating surfaces share `.pos` (z-index 80, above sheets) and `.float`; add new popups to `floating.css`.
- **Order matters**: `styles.css` loads before `globals.css`. A rule in `globals.css` can beat a library rule of equal specificity (it did once, for `.is-on .dico`), so repeat a parent class in the library selector when a screen-level rule might collide.

`Segmented` and `Tabs` share `useIndicator` (`use-indicator.ts`), which measures the active item so one thumb can slide under it on a spring. Use it for any new single-choice bar.

## Added for the backend integration

Designed first, then used by the screens that needed them:
- **`Stepper`**: a bounded number with round − and + buttons (`value`, `onChange`, `min`, `max`, `step`, `unit`, `label`). For small counts such as "backups to keep". The value is a live region; the buttons disable at the limits.
- **`TimeField`**: a 24-hour time of day (`value` "HH:MM", `onChange`, `label`) on the device's native picker.
- **`ActionRow`**: one step of a builder: an icon and verb, the controls that complete it as children, and an optional remove button. The automation builder and the scene and routine builders all use it (it replaced the builder's local `.arow` styles).
- **`Notice`**: an inline message with a tone (`info`, `ok`, `warn`), an icon and an optional action. Warnings use `role="alert"`.

## Added with the backend work

- **`Button loading`** shows a spinner, keeps its width and ignores taps until it clears. Prefer it to swapping the label for "…ing".
- **`Loading`** is the waiting state (a softly breathing mark and a short line). Use it instead of bare "Loading…" text.
- **`Notice`** is the inline message: `tone="warn"` for something to fix (it carries `role="alert"`), `"ok"` for a confirmation, default for information. Use it instead of a coloured paragraph.
- **`Stepper`** supports press-and-hold to run through a range, and arrow keys. Use it for small counts and short ranges; use `Input type="number"` with `inp--sm` for wide ones.
- **`ActionRow`**, **`TimeField`**: as documented in their files. `Input` and `Textarea` take size classes `inp--sm`, `inp--code`, `inp--fill`, `inp--mono` instead of inline widths.
- The sign-in and set-up screens (`components/auth.tsx`) are built from these parts: `Card` (a keyed entrance per step), `Notice` for every error, `Checkbox` rows, `Loading`, and `Button loading`. Fields only auto-focus where there is a fine pointer, so phones do not open the keyboard over the screen.
