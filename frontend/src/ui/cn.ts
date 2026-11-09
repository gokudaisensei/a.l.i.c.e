/** Anything `cn` accepts: strings, falsy values (skipped), arrays, and `{ "class": condition }` objects. */
export type ClassValue = string | number | false | null | undefined | ClassValue[] | { [className: string]: unknown };

/** Join class names. Falsy values are skipped; arrays and `{ name: condition }` objects are flattened. */
export function cn(...parts: ClassValue[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p && p !== 0) continue;
    if (typeof p === "string" || typeof p === "number") out.push(String(p));
    else if (Array.isArray(p)) { const s = cn(...p); if (s) out.push(s); }
    else for (const [k, v] of Object.entries(p)) if (v) out.push(k);
  }
  return out.join(" ");
}
