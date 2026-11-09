export type RGB = [number, number, number];
const clamp = (n: number, a = 0, b = 255) => Math.min(b, Math.max(a, n));

/** Hue 0–360, saturation and value 0–1 → RGB 0–255. */
export function hsvToRgb(h: number, s: number, v = 1): RGB {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), mx === 0 ? 0 : d / mx, mx];
}
/** Approximate colour of a white light at a colour temperature (Kelvin). */
export function kelvinToRgb(k: number): RGB {
  const t = clamp(k, 1000, 10000) / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  return [Math.round(clamp(r)), Math.round(clamp(g)), Math.round(clamp(b))];
}
export const css = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`;
