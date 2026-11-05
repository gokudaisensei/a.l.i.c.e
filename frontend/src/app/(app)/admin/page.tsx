import type { Metadata } from "next";
import { AdminView } from "@/components/admin";

export const metadata: Metadata = { title: "Admin" };
export default function Page() { return <AdminView />; }
