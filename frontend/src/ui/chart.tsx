/** Smooth area sparkline with an end-point dot. */
export function Sparkline({ values, width = 240, height = 56, label = "Trend" }: { values: number[]; width?: number; height?: number; label?: string }) {
  const max = Math.max(...values, 1), n = values.length;
  const pts = values.map((v, i) => [(i / (n - 1)) * width, height - 6 - (v / max) * (height - 14)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < n; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
  const last = pts[n - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--sage)" stopOpacity=".35" /><stop offset="1" stopColor="var(--sage)" stopOpacity="0" /></linearGradient></defs>
      <line x1="0" x2={width} y1={height - 1} y2={height - 1} stroke="var(--line)" />
      <path d={`${d} L${width},${height} L0,${height}Z`} fill="url(#sg)" />
      <path d={d} fill="none" stroke="var(--sage)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={last[0] - 4} cy={last[1]} r="4.5" fill="var(--tile)" stroke="var(--sage)" strokeWidth="2.5" />
    </svg>
  );
}
