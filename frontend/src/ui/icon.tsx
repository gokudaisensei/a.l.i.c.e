import { PATHS } from "./icon-paths";

export function Icon({ n, c = "" }: { n: string; c?: string }) {
  return (
    <svg
      className={`ic ${c}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[n] ?? "" }}
    />
  );
}
