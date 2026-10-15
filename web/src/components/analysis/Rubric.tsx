/* Rubric: a 7-axis radar plus per-dimension bars that explain which flaw cards cost points. */
import { useState } from 'react';
import type { Dimension, FlawCard, Rubric } from '../../types';
import { DIMENSIONS } from '../../types';
import { DIM_BLURB, DIM_LABEL, cssTexture, dimColor } from '../../lib/dimensions';
import { fmt } from '../../lib/format';
import { Swatch } from '../ui';
import SeverityPips from '../SeverityPips';

const COST: Record<number, number> = { 1: 0.3, 2: 0.6, 3: 1.0, 4: 1.6, 5: 2.5 };

/** Points a card removes from its dimension: (60 / speaking time) × c(severity), as in rubric.formula. */
export function cardCost(card: FlawCard, speakingS: number): number {
  const c = COST[Math.round(card.severity)] ?? 0;
  return speakingS > 0 ? (60 / speakingS) * c : 0;
}

export function RubricRadar({
  rubric,
  highlightDim,
  onHighlight,
  size = 280,
}: {
  rubric: Rubric;
  highlightDim: string | null;
  onHighlight: (d: Dimension | null) => void;
  size?: number;
}) {
  const dims = DIMENSIONS.filter((d) => rubric.dimensions[d]);
  const n = dims.length;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 58;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number) => [cx + Math.cos(ang(i)) * R * (v / 10), cy + Math.sin(ang(i)) * R * (v / 10)] as const;
  const poly = dims.map((d, i) => pt(i, Math.max(0, Math.min(10, rubric.dimensions[d]!.score))).join(',')).join(' ');
  const summary = dims.map((d) => `${DIM_LABEL[d]} ${fmt(rubric.dimensions[d]!.score, 1)}`).join(', ');

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Rubric radar out of 10: ${summary}`}
      className="overflow-visible"
    >
      {[2, 4, 6, 8, 10].map((r) => (
        <polygon
          key={r}
          points={dims.map((_, i) => pt(i, r).join(',')).join(' ')}
          fill={r === 10 ? '#f8fafc' : 'none'}
          stroke="#e2e8f0"
          strokeWidth={1}
        />
      ))}
      {[5, 10].map((r) => (
        <text key={r} x={cx + 3} y={cy - R * (r / 10) + 10} fontSize={9} fill="#94a3b8" className="num">
          {r}
        </text>
      ))}
      {dims.map((d, i) => {
        const [x, y] = pt(i, 10);
        const on = highlightDim === d;
        return <line key={d} x1={cx} y1={cy} x2={x} y2={y} stroke={on ? dimColor(d) : '#e2e8f0'} strokeWidth={on ? 2 : 1} />;
      })}
      <polygon points={poly} fill="rgba(55,48,163,0.12)" stroke="#3730a3" strokeWidth={2} strokeLinejoin="round" />
      {dims.map((d, i) => {
        const s = rubric.dimensions[d]!.score;
        const [x, y] = pt(i, Math.max(0, Math.min(10, s)));
        const [lx, ly] = pt(i, 12.6);
        const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
        const on = highlightDim === d;
        return (
          <g
            key={d}
            onMouseEnter={() => onHighlight(d)}
            onMouseLeave={() => onHighlight(null)}
            style={{ cursor: 'default' }}
          >
            <circle cx={x} cy={y} r={on ? 6 : 4.5} fill={dimColor(d)} stroke="#fff" strokeWidth={2} />
            <circle cx={lx} cy={ly} r={22} fill="transparent" />
            <text x={lx} y={ly - 2} textAnchor={anchor} fontSize={11} fontWeight={on ? 700 : 600} fill="#0f172a">
              {DIM_LABEL[d]}
            </text>
            <text x={lx} y={ly + 11} textAnchor={anchor} fontSize={11} fill={s < 10 ? '#0f172a' : '#64748b'} className="num">
              {fmt(s, 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function DimensionBars({
  rubric,
  cards,
  highlightDim,
  onHighlight,
  onFocusCard,
}: {
  rubric: Rubric;
  cards: FlawCard[];
  highlightDim: string | null;
  onHighlight: (d: Dimension | null) => void;
  onFocusCard: (id: string) => void;
}) {
  const [open, setOpen] = useState<Dimension | null>(null);
  const byId = new Map(cards.map((c) => [c.id, c]));
  return (
    <ul className="space-y-1" aria-label="Score per rubric dimension">
      {DIMENSIONS.filter((d) => rubric.dimensions[d]).map((d) => {
        const dim = rubric.dimensions[d]!;
        const score = Math.max(0, Math.min(10, dim.score));
        const lost = 10 - score;
        const costly = dim.flaws.map((id) => byId.get(id)).filter((c): c is FlawCard => !!c);
        const expanded = open === d;
        const on = highlightDim === d;
        return (
          <li key={d}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : d)}
              onMouseEnter={() => onHighlight(d)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(d)}
              onBlur={() => onHighlight(null)}
              className={`grid w-full grid-cols-[104px_minmax(0,1fr)_44px] items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                on ? 'bg-slate-50' : 'hover:bg-slate-50'
              }`}
              title={DIM_BLURB[d]}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <Swatch color={dimColor(d)} texture={cssTexture(d, 0.6)} />
                {dim.label || DIM_LABEL[d]}
              </span>
              <span className="relative h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 rounded-l-full" style={{ width: `${score * 10}%`, backgroundColor: dimColor(d) }} />
                {lost > 0.005 && (
                  <span
                    className="absolute inset-y-0 rounded-r-full"
                    style={{
                      left: `calc(${score * 10}% + 2px)`,
                      width: `calc(${lost * 10}% - 2px)`,
                      backgroundImage: 'repeating-linear-gradient(45deg, rgba(185,28,28,0.45) 0 1.5px, transparent 1.5px 5px)',
                    }}
                  />
                )}
              </span>
              <span className="text-right text-sm font-semibold tabular-nums text-ink">{fmt(score, 1)}</span>
            </button>
            {expanded && (
              <div className="mb-1 ml-[118px] mr-2 rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">
                <p className="text-ink-muted">{DIM_BLURB[d]}</p>
                {costly.length === 0 && dim.style_penalty <= 0.005 && <p className="mt-1">No points lost on this dimension.</p>}
                {costly.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {costly.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => onFocusCard(c.id)}
                          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                        >
                          <SeverityPips severity={c.severity} dimension={c.dimension} />
                          <span className="font-medium text-ink">{c.title}</span>
                          <span className="truncate text-ink-muted">“{c.words}”</span>
                          <span className="ml-auto font-mono text-red-800">−{fmt(cardCost(c, rubric.speaking_s), 2)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {dim.style_penalty > 0.005 && (
                  <p className="mt-1">
                    Overall style penalty (whole-take tempo or pitch range far from the reference):{' '}
                    <span className="font-mono text-red-800">−{fmt(dim.style_penalty, 2)}</span>
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
