import type { Metadata } from "next";
import { AdminView } from "@/components/admin";

// The page renders behind a sign-in gate, so there is nothing to check for instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Admin" };
export default function Page() { return <AdminView />; }
