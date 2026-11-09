/** Trusted in-app HTML (activity strings that carry bold). Never pass user input: it is not sanitised. */
export function Html({ html, as: T = "span" }: {
  /** Markup from the app itself. Never user input: it is not sanitised. */
  html: string;
  /** The element to render. */
  as?: "span" | "div" | "small";
}) {
  return <T data-slot="html" dangerouslySetInnerHTML={{ __html: html }} />;
}
