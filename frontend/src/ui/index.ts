/**
 * Alice UI: presentational components for the Alice Home design.
 * Nothing in here reads app state. Styling lives in `src/app/globals.css`.
 */
export { cn } from "./cn";
export { Icon } from "./icon";
export { PATHS as ICON_PATHS } from "./icon-paths";
export { Button, IconButton, StepButton, buttonVariants, type ButtonProps, type ButtonVariant } from "./button";
export { Pill, Chip, FilterChip, Eyebrow, type Tone } from "./badge";
export { Switch, type SwitchProps } from "./switch";
export { Slider, type SliderProps } from "./slider";
export { Segmented, OptionGroup, OptionButton, type SegmentedProps } from "./segmented";
export { Field, FieldRow, Input, Textarea } from "./fields";
export { Select, type SelectProps } from "./select";
export { Tooltip, TooltipProvider, Popover, PopoverClose } from "./floating";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { Progress } from "./progress";
export { Bar, Avatar, IconTile, Empty, Safe, KeyValue, Steps, Table, PageHeader, Html } from "./data-display";
export { Tabs, type TabsProps } from "./tabs";
export { Tile, TileHeader, Grid, AccordionContext, resetTileOrder, type TileProps, type AccordionApi } from "./tile";
export { Sparkline } from "./chart";
export { Modal, BottomSheet, Toast, ConfirmDialog } from "./overlay";
export { DeviceTile, AddTile, type DeviceTileProps } from "./device-tile";
export { ModeButton, SceneCard } from "./choice";
export { LockTile } from "./lock-tile";
export { Stepper, type StepperProps } from "./stepper";
export { TimeField } from "./time-field";
export { ActionRow } from "./action-row";
export { Notice } from "./notice";
export { Loading } from "./loading";
