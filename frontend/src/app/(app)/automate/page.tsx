import type { Metadata } from "next";
import { BuildView } from "@/components/build";

export const metadata: Metadata = { title: "Automate" };
export default function Page() { return <BuildView />; }
