import type { ComponentProps } from "react";
import { PATHS, FILLED, type IconName } from "./icon-paths";

export type { IconName };

export type IconProps = Omit<ComponentProps<"svg">, "children" | "dangerouslySetInnerHTML"> & {
  /** The icon's name. Any string is accepted (so a name can come from data) and unknown names draw nothing. */
  n: IconName | (string & {});
  /** Extra size or motion classes: `sm`, `lg`, `spin`. */
  c?: string;
  /** Draws the solid form where there is one (the selected tab); otherwise the outline. */
  filled?: boolean;
  /** Gives the icon a name for screen readers. Without it the icon is decorative and hidden from them. */
  title?: string;
};

/** One 24 px icon set, 1.7 stroke, round caps. Decorative by default: pair it with text, or pass `title`. */
export function Icon({ n, c = "", filled, title, className, ...rest }: IconProps) {
  const solid = filled && (FILLED as Record<string, string>)[n];
  const markup = ((solid ? FILLED : PATHS) as Record<string, string>)[n] ?? "";
  return (
    <svg
      data-slot="icon" data-icon={n}
      className={`ic ${solid ? "filled " : ""}${c} ${className ?? ""}`.replace(/\s+/g, " ").trim()}
      viewBox="0 0 24 24"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      {...rest}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
