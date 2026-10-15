/* Judge Mode: for benchmark demos the injected flaws are known, so show what SHRUTI found vs the truth. */
import type { Analysis, BenchLabel, FlawCard } from '../../types';
import { cssTexture, dimColor, flawTypeDim, flawTypeLabel } from '../../lib/dimensions';
import { fmtTime } from '../../lib/format';
import { Swatch } from '../ui';
import { IconCheck, IconX } from '../icons';

type Status = 'found' | 'other' | 'missed';

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.min(a1, b1) > Math.max(a0, b0);
}

export function matchTruth(cards: FlawCard[], labels: BenchLabel[]) {
  const rows = labels.map((l) => {
    const hits = cards.filter((c) => overlap(c.t_start, c.t_end, l.t_start, l.t_end));
    const same = hits.filter((c) => c.type === l.type);
    const status: Status = same.length ? 'found' : hits.length ? 'other' : 'missed';
    return { label: l, status, cards: same.length ? same : hits };
  });
  const extra = cards.filter((c) => !labels.some((l) => overlap(c.t_start, c.t_end, l.t_start, l.t_end)));
  return { rows, extra, found: rows.filter((r) => r.status === 'found').length };
}

export default function DemoBanner({ analysis, cards, onFocusCard }: { analysis: Analysis; cards: FlawCard[]; onFocusCard: (id: string) => void }) {
  const demo = analysis.demo;
  if (!demo) return null;
  const labels = demo.labels ?? [];
  const m = matchTruth(cards, labels);
  return (
    <section className="rounded-lg border border-indigo-200 bg-accent-soft/50 px-4 py-3" aria-label="Judge Mode ground truth">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wide text-accent">Judge Mode · benchmark demo</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{demo.title ?? demo.render_id}</p>
          {demo.description && <p className="mt-0.5 max-w-3xl text-xs text-ink-soft">{demo.description}</p>}
        </div>
        <div className="text-right">
          {labels.length > 0 ? (
            <p className="text-sm text-ink">
              Found <span className="font-semibold num">{m.found}</span> of <span className="font-semibold num">{labels.length}</span> injected flaws
            </p>
          ) : (
            <p className="text-sm text-ink">No flaws injected — the right answer is silence</p>
          )}
          <p className="text-2xs text-ink-muted">
            {m.extra.length === 0 ? 'no extra flags' : `${m.extra.length} extra flag${m.extra.length === 1 ? '' : 's'}`}
            {demo.render_id ? ` · ${demo.render_id}` : ''}
          </p>
        </div>
      </div>
      {labels.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {m.rows.map((r, i) => {
            const d = flawTypeDim(String(r.label.type));
            const target = r.cards[0];
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!target}
                  onClick={() => target && onFocusCard(target.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink-soft enabled:hover:border-accent disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                  title={target ? `Show ${target.title}` : 'Not detected'}
                >
                  {d && <Swatch color={dimColor(d)} texture={cssTexture(d, 0.6)} />}
                  <span className="font-medium text-ink">{flawTypeLabel(String(r.label.type))}</span>
                  {r.label.level != null && <span className="font-mono text-ink-muted">L{String(r.label.level)}</span>}
                  <span className="font-mono text-ink-muted">{fmtTime(r.label.t_start, 1)}</span>
                  {r.status === 'found' ? (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-800">
                      <IconCheck size={12} strokeWidth={3} /> found
                    </span>
                  ) : r.status === 'other' ? (
                    <span className="font-semibold text-amber-800">flagged as {flawTypeLabel(String(r.cards[0]?.type ?? ''))}</span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-red-800">
                      <IconX size={12} strokeWidth={3} /> missed
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
