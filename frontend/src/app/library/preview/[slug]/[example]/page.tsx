import { Suspense } from "react";
import { notFound } from "next/navigation";
import { entries } from "@/library/registry";
import { exampleLoaders } from "@/library/generated/examples";
import { PreviewHost } from "@/library/docs/preview-host";

export const generateStaticParams = () => entries.flatMap((e) => e.examples.map((x) => ({ slug: e.slug, example: x.name })));

/** One example on its own, with nothing around it. The docs page shows it in a frame; this is also its own address. */
export default function Page({ params }: { params: Promise<{ slug: string; example: string }> }) {
  return <Suspense><Example params={params} /></Suspense>;
}
async function Example({ params }: { params: Promise<{ slug: string; example: string }> }) {
  const { slug, example } = await params;
  const load = exampleLoaders[`${slug}/${example}`];
  if (!load) notFound();
  const Demo = (await load()).default;
  return <Suspense><PreviewHost><Demo /></PreviewHost></Suspense>;
}
