import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Loading } from "@/ui";
import { entries, entryBySlug } from "@/library/registry";
import { ComponentPage } from "@/library/docs/component-page";

export const generateStaticParams = () => entries.map((e) => ({ slug: e.slug }));
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const e = entryBySlug((await params).slug);
  return e ? { title: e.title, description: e.description } : {};
}

// The page itself waits for nothing: the part that reads `params` sits inside Suspense, so navigating here shows the frame at once.
export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense fallback={<Loading label="Loading the page…" />}><Content params={params} /></Suspense>;
}
async function Content({ params }: { params: Promise<{ slug: string }> }) {
  const entry = entryBySlug((await params).slug);
  if (!entry) notFound();
  return <ComponentPage entry={entry} />;
}
