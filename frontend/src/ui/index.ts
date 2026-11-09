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
export { ColorWheel, WhiteStrip, CoverShade } from "./color-control";
export { Dial } from "./dial";
export { useDrag, project, type DragVelocity, type DragRaw } from "./use-drag";
export { useDoubleTap } from "./use-double-tap";
export { useSwipeSelect } from "./use-swipe-select";
export { haptic, hapticsSupported, setHapticsEnabled, useHapticsEnabled, HAPTICS, type Haptic } from "./haptics";
export { Segmented, OptionGroup, OptionButton, type SegmentedProps } from "./segmented";
export { Field, FieldRow, Input, Textarea } from "./fields";
export { Select, type SelectProps } from "./select";
export { Tooltip, TooltipProvider, Popover, PopoverClose } from "./floating";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { Progress, Bar } from "./progress";
export { Avatar, IconTile } from "./avatar";
export { Empty } from "./empty";
export { Safe, KeyValue, Steps } from "./lists";
export { Table } from "./table";
export { PageHeader } from "./page-header";
export { Html } from "./html";
export { Tabs, type TabsProps } from "./tabs";
export { Tile, TileHeader, Grid, AccordionContext, type TileProps, type AccordionApi } from "./tile";
export { Sparkline } from "./chart";
export { Modal, BottomSheet, ConfirmDialog } from "./overlay";
export { Toast, toastDuration, type ToastProps, type ToastTone } from "./toast";
export { DeviceTile, AddTile, type DeviceTileProps } from "./device-tile";
export { ModeButton, SceneCard } from "./choice";
export { LockTile } from "./lock-tile";
export { Stepper, type StepperProps } from "./stepper";
export { Nudge } from "./nudge";
export { TimeField } from "./time-field";
export { ActionRow } from "./action-row";
export { Notice } from "./notice";
export { Loading } from "./loading";
