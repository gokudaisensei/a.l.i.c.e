import { highlight, type Lang } from "../code";
import { CopyButton } from "./copy-button";

/** Highlighted code with a copy button. Renders on the server. */
export async function CodeBlock({ code, lang = "tsx", title }: { code: string; lang?: Lang; title?: string }) {
  const html = await highlight(code, lang);
  return (
    <figure className="lib-code">
      {title ? <figcaption>{title}</figcaption> : null}
      <CopyButton text={code} />
      <div className="lib-code-body" dangerouslySetInnerHTML={{ __html: html }} tabIndex={0} role="region" aria-label={title ?? "Code"} />
    </figure>
  );
}
