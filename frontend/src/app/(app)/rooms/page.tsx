import type { Metadata } from "next";
import { RoomsView } from "@/components/rooms";

// The page renders behind a sign-in gate, so there is nothing to check for instant navigation.
export const instant = false;
export const metadata: Metadata = { title: "Rooms" };
export default function Page() { return <RoomsView />; }
