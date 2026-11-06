import type { Metadata } from "next";
import { HomeView } from "@/components/home";

// The page renders behind a sign-in gate, so there is nothing to check for instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Home" };
export default function Page() { return <HomeView />; }
