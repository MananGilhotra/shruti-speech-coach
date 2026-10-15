/* /evaluation — benchmark results on SHRUTI-Bench (dev and held-out test side by side). */
import type { ReactNode } from 'react';
import type { EvalSplit, EvalSummary, PRF } from '../types';
import { ApiError, errorMessage, evalFigureUrl, getEval } from '../api';
import { useAppState } from '../lib/appState';
import { useAsync } from '../lib/useAsync';
import { cssTexture, dimColor, flawTypeDim, flawTypeLabel } from '../lib/dimensions';
import { fmt, isNum } from '../lib/format';
import PsychometricChart from '../components/PsychometricChart';
import { EmptyState, ErrorState, LoadingState, Swatch } from '../components/ui';
import { IconFlask } from '../components/icons';
import { FLAW_TYPES } from '../types';

type SplitKey = 'dev' | 'test';
const SPLITS: { key: SplitKey; label: string; blurb: string }[] = [
  { key: 'dev', label: 'Dev', blurb: 'S1–S4 · used for tuning' },
  { key: 'test', label: 'Test', blurb: 'S5–S6 · held out' },
];

const f3 = (x: number | null | undefined) => fmt(x, 3);

export default function Evaluation() {
  const { online, status } = useAppState();
  const q = useAsync<EvalSummary | null>(async () => (online ? getEval() : null), [online]);

  const header = (
    <header>
      <h1 className="text-2xl font-semibold text-ink">Evaluation</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-soft">
        How well SHRUTI finds injected flaws on SHRUTI-Bench: event-level precision and recall (a detection counts when it overlaps the label
        with IoU ≥ 0.5), how close the boundaries are, how detection grows with severity, and how often it cries wolf on clean controls.
      </p>
    </header>
  );

  if (status === 'checking' || q.loading)
    return (
      <div className="space-y-6">
        {header}
        <LoadingState label="Loading benchmark results…" />
      </div>
    );
  if (!online)
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title="Results are served by the API" icon={<IconFlask size={28} />}>
          Reconnect to the SHRUTI backend to see the benchmark summary.
        </EmptyState>
      </div>
    );
  if (q.error instanceof ApiError && q.error.status === 404)
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title="No benchmark results yet" icon={<IconFlask size={28} />}>
          Run <code className="font-mono">make eval</code> on the server to evaluate the detector on SHRUTI-Bench; this page fills in
          automatically.
        </EmptyState>
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="space-y-6">
        {header}
        <ErrorState title="Could not load the evaluation" message={q.error ? errorMessage(q.error) : 'Empty response'} onRetry={q.reload} />
      </div>
    );

  const S = q.data;
  const splits = SPLITS.filter((s) => S[s.key]);
  if (!splits.length)
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title="The summary has no dev or test split">The results file exists but contains no recognised splits.</EmptyState>
      </div>
    );

  const types = Array.from(
    new Set(splits.flatMap((s) => Object.keys(S[s.key]?.per_type ?? {}))),
  ).sort((a, b) => (FLAW_TYPES as readonly string[]).indexOf(a) - (FLAW_TYPES as readonly string[]).indexOf(b));
  const ffLayers = Array.from(new Set(splits.flatMap((s) => Object.keys(S[s.key]?.false_flags ?? {}))));
  const conditions = Array.from(new Set(splits.flatMap((s) => Object.keys(S[s.key]?.robustness ?? {})))).sort();
  const ious = Array.from(new Set(splits.flatMap((s) => Object.keys(S[s.key]?.by_iou ?? {})))).sort();

  return (
    <div className="space-y-8">
      {header}

      {/* headline cards */}
      <section className="grid grid-cols-2 gap-4" aria-label="Headline metrics">
        {splits.map((s) => (
          <Headline key={s.key} split={S[s.key]!} label={s.label} blurb={s.blurb} />
        ))}
      </section>

      {/* psychometric */}
      <Section
        title="Detection vs severity (psychometric curves)"
        sub="Single-flaw layer: share of renders where the injected flaw was found (IoU ≥ 0.3), per level. ◇ marks L50, the level detected half the time — lower is more sensitive."
      >
        <div className="grid grid-cols-2 gap-6">
          {splits.map((s) =>
            S[s.key]?.psychometric && Object.keys(S[s.key]!.psychometric!).length ? (
              <PsychometricChart key={s.key} data={S[s.key]!.psychometric!} title={`${s.label} · ${s.blurb}`} />
            ) : (
              <p key={s.key} className="text-sm text-ink-muted">
                No psychometric data for {s.label}.
              </p>
            ),
          )}
        </div>
      </Section>

      {/* per type */}
      {types.length > 0 && (
        <Section title="Per flaw type" sub="Event-level precision, recall and F1 at IoU ≥ 0.5.">
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="table-clean">
              <thead>
                <tr>
                  <th className="!pl-4" rowSpan={2}>
                    Flaw type
                  </th>
                  {splits.map((s) => (
                    <th key={s.key} colSpan={4} className="!text-center">
                      {s.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {splits.map((s) => (
                    <PRFHead key={s.key} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {types.map((t) => {
                  const d = flawTypeDim(t);
                  return (
                    <tr key={t}>
                      <td className="!pl-4">
                        <span className="flex items-center gap-2">
                          {d && <Swatch color={dimColor(d)} texture={cssTexture(d, 0.6)} />}
                          <span className="font-medium text-ink">{flawTypeLabel(t)}</span>
                        </span>
                      </td>
                      {splits.map((s) => (
                        <PRFCells key={s.key} prf={S[s.key]?.per_type?.[t]} />
                      ))}
                    </tr>
                  );
                })}
                <tr className="bg-surface-sunken font-semibold">
                  <td className="!pl-4">Micro average</td>
                  {splits.map((s) => (
                    <PRFCells key={s.key} prf={S[s.key]?.micro} />
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* false flags */}
        {ffLayers.length > 0 && (
          <Section title="False flags on controls" sub="Flags raised on renders with no injected flaw. Lower is better.">
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th className="!pl-4">Control layer</th>
                    {splits.map((s) => (
                      <th key={s.key} className="!text-right" colSpan={2}>
                        {s.label}: per min · files flagged
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ffLayers.map((l) => (
                    <tr key={l}>
                      <td className="!pl-4 font-mono text-ink">{l}</td>
                      {splits.map((s) => {
                        const ff = S[s.key]?.false_flags?.[l];
                        return [
                          <td key={`${s.key}a`} className="text-right font-mono">
                            {ff ? fmt(ff.per_minute, 2) : '—'}
                          </td>,
                          <td key={`${s.key}b`} className="text-right font-mono text-ink-muted">
                            {ff ? `${ff.files_with_any_flag}/${ff.files}` : '—'}
                          </td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* robustness */}
        {conditions.length > 0 && (
          <Section title="Robustness to recording conditions" sub="Stress layer (flawed renders): F1 under each channel condition.">
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th className="!pl-4">Condition</th>
                    {splits.map((s) => (
                      <th key={s.key} className="!text-right" colSpan={3}>
                        {s.label}: P · R · F1
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conditions.map((c) => (
                    <tr key={c}>
                      <td className="!pl-4 font-mono text-ink">{c}</td>
                      {splits.map((s) => {
                        const r = S[s.key]?.robustness?.[c];
                        return [
                          <td key={`${s.key}p`} className="text-right font-mono text-ink-muted">
                            {f3(r?.precision)}
                          </td>,
                          <td key={`${s.key}r`} className="text-right font-mono text-ink-muted">
                            {f3(r?.recall)}
                          </td>,
                          <td key={`${s.key}f`} className="text-right font-mono font-semibold">
                            <F1Bar v={r?.f1} />
                          </td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>

      {ious.length > 0 && (
        <Section title="Sensitivity to the overlap threshold" sub="Micro F1 when a detection must overlap its label by at least this IoU.">
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <table className="table-clean">
              <thead>
                <tr>
                  <th className="!pl-4">IoU ≥</th>
                  {splits.map((s) => (
                    <PRFHead key={s.key} prefix={`${s.label} `} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {ious.map((k) => (
                  <tr key={k}>
                    <td className="!pl-4 font-mono">{k}</td>
                    {splits.map((s) => (
                      <PRFCells key={s.key} prf={S[s.key]?.by_iou?.[k]} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {S.figures && S.figures.length > 0 && (
        <Section title="Figures" sub="Generated by the evaluation script.">
          <div className="grid grid-cols-2 gap-4">
            {S.figures.map((f) => (
              <figure key={f} className="rounded-lg border border-line bg-white p-2">
                <img src={evalFigureUrl(f)} alt={f.replace(/[_-]/g, ' ').replace(/\.\w+$/, '')} className="w-full" loading="lazy" />
                <figcaption className="mt-1 font-mono text-2xs text-ink-muted">{f}</figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {sub && <p className="mb-3 mt-0.5 text-sm text-ink-soft">{sub}</p>}
      {children}
    </section>
  );
}

function Headline({ split, label, blurb }: { split: EvalSplit; label: string; blurb: string }) {
  const ci = split.micro_ci?.f1;
  const ff = split.false_flags ?? {};
  const ffClean = ff.clean?.per_minute;
  const ffVoice = ff.voice?.per_minute;
  const b = split.boundary_ms ?? {};
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">{label}</h2>
        <span className="text-2xs text-ink-muted">
          {blurb}
          {isNum(split.n_files) ? ` · ${split.n_files} files` : ''}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-4">
        <Metric
          label="Micro F1"
          value={f3(split.micro?.f1)}
          sub={ci && isNum(ci[0]) && isNum(ci[1]) ? `95% CI ${fmt(ci[0], 3)}–${fmt(ci[1], 3)}` : 'IoU ≥ 0.5'}
          big
        />
        <Metric label="Precision · Recall" value={`${fmt(split.micro?.precision, 2)} · ${fmt(split.micro?.recall, 2)}`} sub={`macro F1 ${f3(split.macro_f1)}`} />
        <Metric
          label="Boundary error"
          value={isNum(b.start_median) ? `${Math.round(b.start_median)} / ${Math.round(b.end_median ?? NaN)} ms` : '—'}
          sub={`median start / end · mean IoU ${fmt(b.mean_iou, 2)}`}
        />
        <Metric
          label="False flags / min"
          value={`${fmt(ffClean, 2)} · ${fmt(ffVoice, 2)}`}
          sub="clean · voice controls"
        />
      </div>
      {isNum(split.gradient?.spearman_median) && (
        <p className="mt-3 border-t border-line pt-2 text-xs text-ink-soft">
          <span className="font-semibold text-ink">Severity monotonicity:</span> Spearman ρ between injected level and overall score, median{' '}
          <span className="font-mono font-semibold text-ink">{fmt(split.gradient?.spearman_median, 2)}</span>
          {isNum(split.gradient?.series) ? ` over ${split.gradient?.series} gradient series` : ''} — scores should fall (ρ → −1) as flaws get
          stronger.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, sub, big = false }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-0.5 font-semibold text-ink num ${big ? 'text-3xl' : 'text-lg'}`}>{value}</div>
      {sub && <div className="text-2xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function PRFHead({ prefix = '' }: { prefix?: string }) {
  return (
    <>
      <th className="!text-right">{prefix}P</th>
      <th className="!text-right">R</th>
      <th className="!text-right">F1</th>
      <th className="!text-right">TP/FP/FN</th>
    </>
  );
}

function PRFCells({ prf }: { prf: PRF | undefined }) {
  return (
    <>
      <td className="text-right font-mono text-ink-muted">{f3(prf?.precision)}</td>
      <td className="text-right font-mono text-ink-muted">{f3(prf?.recall)}</td>
      <td className="text-right font-mono font-semibold">
        <F1Bar v={prf?.f1} />
      </td>
      <td className="text-right font-mono text-2xs text-ink-muted">{prf && isNum(prf.tp) ? `${prf.tp}/${prf.fp}/${prf.fn}` : '—'}</td>
    </>
  );
}

function F1Bar({ v }: { v: number | null | undefined }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${isNum(v) ? Math.max(0, Math.min(1, v)) * 100 : 0}%` }} />
      </span>
      {f3(v)}
    </span>
  );
}
