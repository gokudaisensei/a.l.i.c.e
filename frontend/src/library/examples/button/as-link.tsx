"use client";
import Link from "next/link";
import { buttonVariants } from "@/ui";

export default function AsLink() {
  return (
    <div className="lib-demo">
      <Link href="/library" className={buttonVariants({ variant: "primary" })}>Back to the library</Link>
      <Link href="/library/components/button/" className={buttonVariants({ variant: "ghost", size: "sm" })}>This page</Link>
    </div>
  );
}
