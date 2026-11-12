// Structural differ (runbook §8.2/T1.4). Three kinds:
//   identical       — same normalized structure and values
//   shape-identical — same keys and types, but some normalized value differs (e.g. id prefix/length)
//   different       — a key or type differs; reported with a JSON path and both values
import { normalize, type NormalizeOptions } from "./normalize.ts";

export type DiffKind = "identical" | "shape-identical" | "different";

export interface Difference {
  path: string;
  left: unknown;
  right: unknown;
}

export interface DiffResult {
  kind: DiffKind;
  differences: Difference[];
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}

/** A value's structural skeleton: keys and primitive types, ignoring scalar values. */
export function skeleton(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(skeleton);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) out[k] = skeleton((value as any)[k]);
    return out;
  }
  return typeof value;
}

function collect(a: unknown, b: unknown, path: string, diffs: Difference[], unordered: string[], key?: string): void {
  if (Object.is(a, b)) return;
  if (a === null || b === null || typeof a !== typeof b) {
    diffs.push({ path, left: a, right: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    let left = a;
    let right = b;
    if (key && unordered.includes(key)) {
      left = [...a].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
      right = [...b].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    }
    if (left.length !== right.length) {
      diffs.push({ path: `${path}.length`, left: left.length, right: right.length });
    }
    const n = Math.min(left.length, right.length);
    for (let i = 0; i < n; i++) collect(left[i], right[i], `${path}[${i}]`, diffs, unordered);
    return;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    for (const k of new Set([...ak, ...bk])) {
      const av = (a as any)[k];
      const bv = (b as any)[k];
      const present = k in (a as object);
      const presentB = k in (b as object);
      if (!present || !presentB) {
        diffs.push({ path: `${path}.${k}`, left: present ? av : "<missing>", right: presentB ? bv : "<missing>" });
        continue;
      }
      collect(av, bv, `${path}.${k}`, diffs, unordered, k);
    }
    return;
  }
  diffs.push({ path, left: a, right: b });
}

export interface DiffOptions extends NormalizeOptions {
  /** Normalize both sides first (default true). */
  normalized?: boolean;
}

export function diff(a: unknown, b: unknown, opts: DiffOptions = {}): DiffResult {
  const normalized = opts.normalized ?? true;
  const left = normalized ? normalize(a, opts) : a;
  const right = normalized ? normalize(b, opts) : b;
  const differences: Difference[] = [];
  collect(left, right, "$", differences, opts.unordered ?? []);
  if (differences.length === 0) return { kind: "identical", differences };
  const sameShape = deepEqual(skeleton(left), skeleton(right));
  return { kind: sameShape ? "shape-identical" : "different", differences };
}
