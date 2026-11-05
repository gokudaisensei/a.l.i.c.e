import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "./cn";

export type ButtonVariant = "default" | "primary" | "sage" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT: Record<ButtonVariant, string> = { default: "", primary: "btn--p", sage: "btn--sage", danger: "btn--danger" };

/** Pill-shaped action button. Icons and text go in as children. */
export function Button({ variant = "default", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={cn("btn", VARIANT[variant], size === "sm" && "btn--sm", className)} {...rest} />;
}

/** Square, icon-only button. Always pass `aria-label`. */
export function IconButton({ active, className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type={type} className={cn("icon-btn", active && "on", className)} {...rest} />;
}

/** Round stepper button (+ / −). */
export function StepButton({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn("step-btn", className)} {...rest} />;
}
