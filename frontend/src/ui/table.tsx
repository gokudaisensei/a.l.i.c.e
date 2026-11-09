import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** A simple table that scrolls sideways on a narrow screen. `mono` sets it in the code font. */
export function Table({ head, rows, mono, className, ...rest }: Omit<ComponentProps<"table">, "children"> & {
  /** Column headings. */
  head: string[];
  /** One array of cells per row. */
  rows: ReactNode[][];
  /** Sets the table in the code font, smaller. */
  mono?: boolean;
}) {
  return (
    <div className="tscroll"><table data-slot="table" className={cn("table", mono && "mono", className)} {...rest}>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}
