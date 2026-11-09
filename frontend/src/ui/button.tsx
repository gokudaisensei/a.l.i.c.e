import type { ComponentProps } from "react";
import { cva } from "class-variance-authority";
import { cn } from "./cn";
import { Icon } from "./icon";
import { haptic as play, type Haptic } from "./haptics";

/** Class recipe for anything that should look like a button (links, triggers). */
export const buttonVariants = cva("btn", {
  variants: {
    variant: { default: "", primary: "btn--p", sage: "btn--sage", danger: "btn--danger", ghost: "btn--ghost" },
    size: { sm: "btn--sm", md: "", lg: "btn--lg" },
  },
  defaultVariants: { variant: "default", size: "md" },
});

export type ButtonVariant = NonNullable<ButtonProps["variant"]>;
export type ButtonProps = ComponentProps<"button"> & {
  /** `primary` is the one main action on a surface (dark); `sage` confirms calmly; `danger` is for things that cannot be undone; `ghost` is borderless; the default is a quiet fill. */
  variant?: "default" | "primary" | "sage" | "danger" | "ghost";
  /** `md` is 42 px tall; `lg` is 52 px (thumb-sized, for the main action on a phone); `sm` is for dense rows. */
  size?: "sm" | "md" | "lg";
  /** Shows a spinner, keeps the width, and ignores taps until it clears. */
  loading?: boolean;
  /** A haptic on press. Off by default: a plain tap needs none. Use `medium` for the one action that sends something out, `warning` for a danger button. */
  haptic?: Haptic;
};

/** Pill-shaped action button. Icons and text go in as children. Ref and native props pass through. */
export function Button({ variant, size, className, type = "button", loading, children, disabled, haptic, onClick, ...rest }: ButtonProps) {
  return (
    <button data-slot="button" data-variant={variant ?? "default"} data-loading={loading ? "" : undefined} aria-busy={loading || undefined} type={type}
      className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} onClick={(e) => { if (haptic) play(haptic); onClick?.(e); }} {...rest}>
      {loading ? <Icon n="refresh" c="sm spin" /> : null}{children}
    </button>
  );
}

/** Square, icon-only button. It has no visible text, so it must carry an accessible name. */
export function IconButton({ active, className, type = "button", haptic, onClick, ...rest }: Omit<ComponentProps<"button">, "aria-label"> & {
  /** Names the button for screen readers. Required: there is no text to read. */
  "aria-label": string;
  /** Marks it as the current choice (a pressed look). */
  active?: boolean;
  /** A haptic on press. Off by default. */
  haptic?: Haptic;
}) {
  return <button data-slot="icon-button" data-active={active ? "" : undefined} type={type} className={cn("icon-btn", active && "on", className)} onClick={(e) => { if (haptic) play(haptic); onClick?.(e); }} {...rest} />;
}

/** Round stepper button (plus or minus). Like `IconButton`, it needs an accessible name. */
export function StepButton({ className, type = "button", haptic, onClick, ...rest }: Omit<ComponentProps<"button">, "aria-label"> & {
  /** Names the button for screen readers: "More backups". */
  "aria-label": string;
  /** A haptic on press. Off by default: a `Stepper` ticks for itself. */
  haptic?: Haptic;
}) {
  return <button data-slot="step-button" type={type} className={cn("step-btn", className)} onClick={(e) => { if (haptic) play(haptic); onClick?.(e); }} {...rest} />;
}
