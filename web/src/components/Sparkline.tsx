/** Tiny line of attempt scores (0–10) with the latest point marked. */
export default function Sparkline({
  values,
  width = 120,
  height = 32,
  max = 10,
  baseline,
}: {
  values: number[];
  width?: number;
  height?: number;
  max?: number;
  baseline?: number;
}) {
  if (!values.length) return null;
  const pad = 4;
  const x = (i: number) => (values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * (width - 2 * pad));
  const y = (v: number) => height - pad - (Math.max(0, Math.min(max, v)) / max) * (height - 2 * pad);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={`Scores over ${values.length} attempts: ${values.map((v) => v.toFixed(1)).join(', ')}`}>
      {baseline != null && (
        <line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} stroke="#b45309" strokeWidth={1} strokeDasharray="3 2" />
      )}
      <path d={d} fill="none" stroke="#3730a3" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={4} fill="#3730a3" stroke="#fff" strokeWidth={2} />
    </svg>
  );
}
