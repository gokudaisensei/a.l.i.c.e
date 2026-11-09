import type { ReactNode } from "react";
import { LibraryShell } from "@/library/docs/shell";

export default function DocsLayout({ children }: { children: ReactNode }) { return <LibraryShell>{children}</LibraryShell>; }
