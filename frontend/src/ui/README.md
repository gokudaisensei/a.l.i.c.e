# Alice UI

Presentational components for the Alice Home design. Import everything from `@/ui`.

**Rules**
- Nothing here imports from `@/lib` or reads app state. Behaviour comes in through props.
- Styling lives in `src/app/globals.css` (design tokens as CSS variables, class names such as `.tile`, `.btn`, `.pill`).
- App-specific wrappers that know about devices live in `src/components/device-controls.tsx`.
- Browse every component at `/library`.

| Group | Components |
|---|---|
| Actions | `Button`, `IconButton`, `StepButton` |
| Status | `Pill`, `Chip`, `FilterChip`, `Eyebrow` |
| Inputs | `Switch`, `Slider`, `Segmented`, `OptionGroup`, `OptionButton`, `Field`, `FieldRow`, `Input`, `Textarea`, `Select` |
| Layout | `Tile`, `TileHeader`, `Grid`, `AccordionContext`, `PageHeader`, `Tabs` |
| Data | `Bar`, `Avatar`, `IconTile`, `Empty`, `Safe`, `KeyValue`, `Steps`, `Table`, `Sparkline`, `Html` |
| Overlays | `Scrim`, `Sheet`, `ConfirmDialog`, `Toast` |
| Icons | `Icon` (24px grid, 1.7 stroke) |

`Tile` staggers its entrance by render order: call `resetTileOrder()` at the top of a view.
`Tile` becomes a phone accordion when wrapped in `AccordionContext.Provider`; you own the open state.
`Html` is for trusted in-app strings only.
