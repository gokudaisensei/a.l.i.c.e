import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Loading } from "@/ui";
import { foundations } from "@/library/registry";
import { FoundationPage } from "@/library/docs/foundations";

export const generateStaticParams = () => foundations.map((f) => ({ slug: f.slug }));
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = (await params).slug;
  const f = foundations.find((x) => x.slug === slug);
  return f ? { title: f.title, description: f.description } : {};
}
export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense fallback={<Loading label="Loading the page…" />}><Content params={params} /></Suspense>;
}
async function Content({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  if (!foundations.some((f) => f.slug === slug)) notFound();
  return <FoundationPage slug={slug} />;
}
