/* Detection rate vs injected severity level, one line per flaw type, with L50 markers. */
import { useMemo, useState } from 'react';
import { dimColor, flawTypeDash, flawTypeDim, flawTypeLabel } from '../lib/dimensions';
import { fmt, fmtPct, isNum } from '../lib/format';
import { FLAW_TYPES } from '../types';

export interface PsyCurve {
  rates: Record<string, number>;
  L50: number | null;
  slope: number | null;
}

export default function PsychometricChart({
  data,
  title,
  width = 560,
  height = 300,
}: {
  data: Record<string, PsyCurve>;
  title: string;
  width?: number;
  height?: number;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [hoverLevel, setHoverLevel] = useState<number | null>(null);
  const types = useMemo(() => {
    const known = FLAW_TYPES.filter((t) => data[t]);
    const extra = Object.keys(data).filter((t) => !(FLAW_TYPES as readonly string[]).includes(t));
    return [...known, ...extra];
  }, [data]);
  const m = { l: 40, r: 14, t: 14, b: 32 };
  const W = width - m.l - m.r;
  const H = height - m.t - m.b;
  const x = (lv: number) => m.l + (lv / 10) * W;
  const y = (r: number) => m.t + (1 - r) * H;

  const series = types.map((t) => {
    const pts = Object.entries(data[t].rates ?? {})
      .map(([k, v]) => [Number(k), v] as [number, number])
      .filter(([k, v]) => isNum(k) && isNum(v))
      .sort((a, b) => a[0] - b[0]);
    const d = flawTypeDim(t);
    return { type: t, pts, color: d ? dimColor(d) : '#64748b', dash: flawTypeDash(t), L50: data[t].L50 };
  });

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const lv = Math.round(((px - m.l) / W) * 10);
    setHoverLevel(lv >= 0 && lv <= 10 ? lv : null);
  };

  const tableSummary = series.map((s) => `${flawTypeLabel(s.type)} L50 ${isNum(s.L50) ? fmt(s.L50, 1) : 'not reached'}`).join('; ');

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs font-semibold text-ink">{title}</figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Psychometric curves. ${tableSummary}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverLevel(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <g key={r}>
              <line x1={m.l} x2={m.l + W} y1={y(r)} y2={y(r)} stroke={r === 0.5 ? '#cbd5e1' : '#eef2f6'} strokeWidth={1} />
              <text x={m.l - 6} y={y(r) + 3} textAnchor="end" fontSize={10} fill="#64748b">
                {Math.round(r * 100)}%
              </text>
            </g>
          ))}
          {Array.from({ length: 11 }, (_, i) => (
            <text key={i} x={x(i)} y={m.t + H + 14} textAnchor="middle" fontSize={10} fill="#64748b">
              {i}
            </text>
          ))}
          <text x={m.l + W / 2} y={height - 3} textAnchor="middle" fontSize={10} fill="#64748b">
            injected severity level
          </text>
          {hoverLevel != null && <line x1={x(hoverLevel)} x2={x(hoverLevel)} y1={m.t} y2={m.t + H} stroke="#94a3b8" strokeWidth={1} />}
          {series.map((s) => {
            const dim = focus != null && focus !== s.type;
            const path = s.pts.map(([lv, r], i) => `${i ? 'L' : 'M'}${x(lv).toFixed(1)},${y(r).toFixed(1)}`).join(' ');
            return (
              <g key={s.type} opacity={dim ? 0.15 : 1}>
                <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash.join(' ')} strokeLinejoin="round" strokeLinecap="round" />
                {s.pts.map(([lv, r]) => (
                  <circle key={lv} cx={x(lv)} cy={y(r)} r={hoverLevel === lv ? 4.5 : 3} fill={s.color} stroke="#fff" strokeWidth={1.5} />
                ))}
                {isNum(s.L50) && s.L50 >= 0 && s.L50 <= 10 && (
                  <path
                    d={`M${x(s.L50)},${y(0.5) - 6} l5,6 l-5,6 l-5,-6 z`}
                    fill="#fff"
                    stroke={s.color}
                    strokeWidth={2}
                  >
                    <title>{`${flawTypeLabel(s.type)}: L50 = ${fmt(s.L50, 2)}`}</title>
                  </path>
                )}
              </g>
            );
          })}
        </svg>
        {hoverLevel != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-48 rounded-md border border-line bg-white/95 px-2 py-1.5 text-2xs shadow-[0_4px_12px_rgba(15,23,42,0.08)]"
            style={{ left: `calc(${(x(hoverLevel) / width) * 100}% + ${hoverLevel > 6 ? -200 : 10}px)` }}
          >
            <div className="mb-0.5 font-semibold text-ink">Level {hoverLevel}</div>
            {series.map((s) => {
              const p = s.pts.find(([lv]) => lv === hoverLevel);
              return (
                <div key={s.type} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-ink-soft">
                    <LineKey color={s.color} dash={s.dash} />
                    {flawTypeLabel(s.type)}
                  </span>
                  <span className="font-mono text-ink">{p ? fmtPct(p[1]) : '—'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
        {series.map((s) => (
          <li key={s.type}>
            <button
              type="button"
              onMouseEnter={() => setFocus(s.type)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(s.type)}
              onBlur={() => setFocus(null)}
              className="inline-flex items-center gap-1.5 rounded px-1 text-2xs text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              <LineKey color={s.color} dash={s.dash} />
              {flawTypeLabel(s.type)}
              <span className="font-mono text-ink-muted">L50 {isNum(s.L50) ? fmt(s.L50, 1) : '—'}</span>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function LineKey({ color, dash }: { color: string; dash: number[] }) {
  return (
    <svg width={18} height={8} aria-hidden="true">
      <line x1={1} x2={17} y1={4} y2={4} stroke={color} strokeWidth={2} strokeDasharray={dash.map((d) => d * 0.6).join(' ')} strokeLinecap="round" />
    </svg>
  );
}
