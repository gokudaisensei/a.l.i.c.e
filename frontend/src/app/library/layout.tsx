import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/library/library.css";

export const metadata: Metadata = { title: { default: "Library", template: "%s · Alice library" }, description: "The components, tokens and rules the Alice interface is built from." };

export default function Layout({ children }: { children: ReactNode }) { return children; }
