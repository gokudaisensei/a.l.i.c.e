"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Segmented, Select, IconButton, Icon } from "@/ui";

const WIDTHS = [["390", "Phone"], ["768", "Tablet"], ["100%", "Wide"]] as const;
const TEXT = [["1", "100%"], ["1.3", "130%"], ["1.75", "175%"], ["2", "200%"], ["3", "300%"]] as const;

/**
 * A live example in its own frame, so it is truly responsive (the frame has its own viewport) and anything that floats
 * (sheets, dialogs, toasts) stays inside it. The toolbar changes the frame's width and the text size. The theme follows
 * the page's theme switch (the frame shares its storage). The frame reports its height, so it fits its content.
 */
export function Preview({ slug, name, title, height, defaultWidth = "100%" }: { slug: string; name: string; title: string; height?: number; defaultWidth?: string }) {
  const id = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState<string>(defaultWidth);
  const [text, setText] = useState("1");
  const [h, setH] = useState(height ?? 160);
  const [nonce, setNonce] = useState(0);
  const src = `/library/preview/${slug}/${name}?text=${text}&k=${encodeURIComponent(id)}`;

  useEffect(() => {
    if (height) return;
    const on = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && e.data?.type === "alice-preview-height") setH(Math.max(96, Math.ceil(e.data.height))); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [height]);

  return (
    <div className="lib-preview" data-slot="preview">
      <div className="lib-toolbar" role="toolbar" aria-label={`Preview options for ${title}`}>
        <Segmented value={width} label="Width" items={WIDTHS.map(([v, l]) => [v, l] as const)} onChange={setWidth} />
        <Select value={text} onChange={setText} label="Text size" options={TEXT.map(([v, l]) => [v, `Text ${l}`] as const)} />
        <span className="lib-spacer" />
        <IconButton aria-label="Reload the example" onClick={() => setNonce((n) => n + 1)}><Icon n="refresh" /></IconButton>
        <a className="icon-btn" href={`/library/preview/${slug}/${name}`} target="_blank" rel="noreferrer" aria-label="Open the example in its own tab"><Icon n="exit" /></a>
      </div>
      <div className="lib-stage">
        <iframe ref={frame} key={nonce} title={`${title} example`} src={src} className="lib-frame" style={{ width: width === "100%" ? "100%" : `min(${width}px, 100%)`, height: h }} loading="lazy" />
      </div>
    </div>
  );
}
