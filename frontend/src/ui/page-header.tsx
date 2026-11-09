import type { ComponentProps } from "react";
import { cn } from "./cn";

/** Page title block: the page's one `h1`, with an optional line under it. */
export function PageHeader({ title, children, className, ...rest }: Omit<ComponentProps<"div">, "title"> & {
  /** The page title (the one `h1`). */
  title: string;
}) {
  return <div data-slot="page-header" className={cn("ph", className)} {...rest}><div><h1>{title}</h1>{children ? <p>{children}</p> : null}</div></div>;
}
