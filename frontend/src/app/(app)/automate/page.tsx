import type { Metadata } from "next";
import { BuildView } from "@/components/build";

// The page renders behind a sign-in gate, so there is nothing to check for instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Automate" };
export default function Page() { return <BuildView />; }
