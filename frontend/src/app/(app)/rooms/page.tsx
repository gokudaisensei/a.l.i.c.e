import type { Metadata } from "next";
import { RoomsView } from "@/components/rooms";

export const metadata: Metadata = { title: "Rooms" };
export default function Page() { return <RoomsView />; }
