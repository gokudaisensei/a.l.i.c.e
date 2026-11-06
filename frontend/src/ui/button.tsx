import type { ButtonHTMLAttributes, Ref } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";
import { Icon } from "./icon";

/** Class recipe for anything that should look like a button (links, triggers). */
export const buttonVariants = cva("btn", {
  variants: {
    variant: { default: "", primary: "btn--p", sage: "btn--sage", danger: "btn--danger", ghost: "btn--ghost" },
    size: { sm: "btn--sm", md: "", lg: "btn--lg" },
  },
  defaultVariants: { variant: "default", size: "md" },
});

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { ref?: Ref<HTMLButtonElement>; /** Shows a spinner, keeps the width, and ignores taps until it clears. */ loading?: boolean };

/** Pill-shaped action button. Icons and text go in as children. Ref and native props pass through. */
export function Button({ variant, size, className, type = "button", loading, children, disabled, ...rest }: ButtonProps) {
  return (
    <button data-slot="button" data-variant={variant ?? "default"} data-loading={loading ? "" : undefined} aria-busy={loading || undefined} type={type}
      className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...rest}>
      {loading ? <Icon n="refresh" c="sm spin" /> : null}{children}
    </button>
  );
}

/** Square, icon-only button. Always pass `aria-label`. */
export function IconButton({ active, className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button data-slot="icon-button" type={type} className={cn("icon-btn", active && "on", className)} {...rest} />;
}

/** Round stepper button (+ / −). */
export function StepButton({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button data-slot="step-button" type={type} className={cn("step-btn", className)} {...rest} />;
}
