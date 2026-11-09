"use client";
import { Icon } from "@/ui";

export default function Labelled() {
  return <div className="lib-demo"><Icon n="alert" title="Needs attention" c="lg" /><span>An icon with a name is an image to a screen reader.</span></div>;
}
