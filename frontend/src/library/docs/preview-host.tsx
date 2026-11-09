"use client";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/** Wraps an example inside its frame: applies the chosen text size and tells the page how tall the example is. */
export function PreviewHost({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const box = useRef<HTMLDivElement>(null);
  const text = Number(params.get("text") ?? "1") || 1;

  // inside a frame the page has no app chrome: no body padding, no phone tab-bar fade
  useLayoutEffect(() => { document.body.classList.add("lib-embed"); return () => document.body.classList.remove("lib-embed"); }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (text === 1) root.style.removeProperty("font-size"); else root.style.setProperty("font-size", `${16 * text}px`, "important");
    window.dispatchEvent(new Event("resize")); // lets the text-size tier script notice
    return () => { root.style.removeProperty("font-size"); };
  }, [text]);

  useEffect(() => {
    const send = () => { if (window.parent !== window) window.parent.postMessage({ type: "alice-preview-height", height: (box.current?.getBoundingClientRect().height ?? 0) + 2 }, window.location.origin); };
    const ro = new ResizeObserver(send);
    if (box.current) ro.observe(box.current);
    send();
    return () => ro.disconnect();
  }, []);

  return <div ref={box} className="lib-host" data-slot="preview-host">{children}</div>;
}
