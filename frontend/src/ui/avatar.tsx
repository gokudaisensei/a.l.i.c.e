import type { ComponentProps } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

/** Round initial. `tone` 1 to 4 picks the colour; `away` greys it. */
export function Avatar({ initial, tone, away, className, ...rest }: Omit<ComponentProps<"span">, "children"> & {
  /** One letter. */
  initial: string;
  /** 1 to 4. */
  tone: number;
  /** Greys it: the person is away. */
  away?: boolean;
}) {
  return <span data-slot="avatar" data-away={away ? "" : undefined} className={cn("av", `a${tone}`, away && "away", className)} {...rest}>{initial}</span>;
}

/** Square icon holder used at the start of rows. */
export function IconTile({ icon, className, ...rest }: Omit<ComponentProps<"span">, "children"> & { icon: string }) {
  return <span data-slot="icon-tile" className={cn("dico", className)} {...rest}><Icon n={icon} /></span>;
}
