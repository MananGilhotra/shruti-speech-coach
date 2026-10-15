/* /explore — Benchmark Explorer: slide a flaw bundle from level 0 to 10 and analyse any render. */
import { useEffect, useMemo, useState } from 'react';
import type { BenchRow } from '../types';
import { benchAudioUrl, errorMessage, fetchBlob, getBenchSeries } from '../api';
import { useAppState } from '../lib/appState';
import { useAsync } from '../lib/useAsync';
import { useScripts } from '../lib/data';
import { cssTexture, dimColor, dimLabel, flawTypeDim, flawTypeLabel } from '../lib/dimensions';
import { fmt, fmtTime, isNum } from '../lib/format';
import MiniWave, { type MiniRegion } from '../components/MiniWave';
import AnalysisProgress, { useAnalysisSubmit } from '../components/AnalysisProgress';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Notice, Segmented, Swatch } from '../components/ui';
import { IconFlask } from '../components/icons';

const LAYERS: { layer: string; what: string; why: string; dev: number; test: number }[] = [
  { layer: 'identity', what: 'Original recordings passed through the renderer untouched', why: 'Sanity check — should raise no flags', dev: 4, test: 2 },
  { layer: 'clean', what: 'Originals with nuisance variation only (tempo, gain, room)', why: 'False-flag control', dev: 24, test: 12 },
  { layer: 'single', what: 'One injected flaw of one type, levels 1–10', why: 'Detection rate vs severity (psychometric curves)', dev: 390, test: 200 },
  { layer: 'gradient', what: 'A bundle of three flaws swept from level 0 to 10', why: 'Scores must fall monotonically with severity', dev: 88, test: 44 },
  { layer: 'voice', what: 'Pitch/formant-shifted voices without flaws', why: 'A different voice is not a flaw', dev: 16, test: 8 },
  { layer: 'stress', what: 'Channel stress (gain, noise, codec, reverb), with and without flaws', why: 'Robustness to recording conditions', dev: 84, test: 42 },
];

export default function Explore() {
  const { online, status } = useAppState();
  const { scripts } = useScripts();
  const [sid, setSid] = useState('S1');
  const series = useAsync(async () => (online ? getBenchSeries(sid) : ([] as BenchRow[])), [sid, online]);
  const rows = useMemo(() => (series.data ?? []).slice().sort((a, b) => a.level - b.level), [series.data]);
  const [level, setLevel] = useState(0);
  const { state, submit, reset } = useAnalysisSubmit();
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  useEffect(() => {
    setLevel(rows.length ? rows[Math.min(rows.length - 1, 3)].level : 0);
    reset();
  }, [rows, reset]);

  const row = rows.find((r) => r.level === level) ?? null;
  const levels = rows.map((r) => r.level);
  const bundle = row?.bundle ?? rows.find((r) => r.bundle?.length)?.bundle ?? [];
  const script = scripts.find((s) => s.script_id === sid);

  const regions: MiniRegion[] = useMemo(
    () =>
      (row?.labels ?? []).map((l, i) => {
        const d = flawTypeDim(String(l.type));
        return {
          id: `l${i}`,
          start: l.t_start,
          end: l.t_end,
          color: d ? dimColor(d) : '#64748b',
          dimension: d ?? undefined,
          label: `${flawTypeLabel(String(l.type))}${isNum(l.level) ? ` · L${l.level}` : ''}`,
        };
      }),
    [row],
  );

  const analyse = async () => {
    if (!row) return;
    setFetchErr(null);
    try {
      const blob = await fetchBlob(benchAudioUrl(row.render_id));
      await submit(blob, `${row.render_id}.flac`, { scriptId: row.script_id, bootstrap: true }, false);
    } catch (e) {
      setFetchErr(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Benchmark Explorer</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          SHRUTI-Bench injects flaws with known type, position and strength into the original recordings, so every label is exact. Slide a
          bundle of flaws from <strong>level 0</strong> (none) to <strong>level 10</strong> (extreme), listen, and send any render through the
          full pipeline.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Script"
          value={sid}
          onChange={setSid}
          options={['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((s) => ({ value: s, label: s }))}
        />
        {script && (
          <span className="text-sm text-ink-soft">
            {script.title} · {script.speaker} {script.year}
            {script.split === 'test' && (
              <Badge tone="amber" className="ml-2">
                held-out test script
              </Badge>
            )}
          </span>
        )}
      </div>

      {status !== 'checking' && !online ? (
        <EmptyState title="The benchmark needs the API" icon={<IconFlask size={28} />}>
          Renders are served by the SHRUTI backend. Start it (or reconnect) to explore the gradient series.
        </EmptyState>
      ) : series.loading ? (
        <LoadingState label="Loading gradient series…" />
      ) : series.error ? (
        <ErrorState title="Could not load the gradient series" message={errorMessage(series.error)} onRetry={series.reload} />
      ) : rows.length === 0 ? (
        <EmptyState title="No renders for this script yet" icon={<IconFlask size={28} />}>
          Build the benchmark with <code className="font-mono">make dataset</code> (or install the demo pack) and refresh.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-5">
          <section className="space-y-4 rounded-lg border border-line bg-white p-5">
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="sev" className="text-sm font-semibold text-ink">
                  Severity
                </label>
                <span className="font-mono text-sm text-ink num">
                  level <span className="text-lg font-semibold">{level}</span> / 10
                </span>
              </div>
              <input
                id="sev"
                type="range"
                className="range mt-2"
                min={Math.min(...levels)}
                max={Math.max(...levels)}
                step={1}
                value={level}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const nearest = levels.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), levels[0]);
                  setLevel(nearest);
                  reset();
                }}
                aria-valuetext={`Level ${level} of 10`}
              />
              <div className="mt-1 flex justify-between font-mono text-2xs text-ink-faint" aria-hidden="true">
                {Array.from({ length: 11 }, (_, i) => (
                  <span key={i} className={levels.includes(i) ? (i === level ? 'font-semibold text-accent' : '') : 'opacity-30'}>
                    {i}
                  </span>
                ))}
              </div>
              {bundle.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  Bundle:
                  {bundle.map((t) => {
                    const d = flawTypeDim(t);
                    return (
                      <span key={t} className="inline-flex items-center gap-1">
                        {d && <Swatch color={dimColor(d)} texture={cssTexture(d, 0.6)} />}
                        {flawTypeLabel(t)}
                      </span>
                    );
                  })}
                </p>
              )}
            </div>

            {row && (
              <>
                <MiniWave url={benchAudioUrl(row.render_id)} height={110} regions={regions} />
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-2xs text-ink-muted">
                    {row.render_id} · {fmt(row.duration_s, 1)} s
                  </span>
                  <Button variant="primary" onClick={() => void analyse()} disabled={state.phase !== 'idle' && state.phase !== 'error'}>
                    Analyse this file
                  </Button>
                </div>
                {fetchErr && <Notice>Could not fetch the render: {fetchErr}</Notice>}
                <AnalysisProgress state={state} onRetry={reset} />
              </>
            )}
          </section>

          <aside className="rounded-lg border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Ground-truth labels at level {level}</h2>
              <p className="text-2xs text-ink-muted">What the detector should find — type, exact time and strength.</p>
            </div>
            {row && row.labels.length > 0 ? (
              <table className="table-clean text-xs">
                <thead>
                  <tr>
                    <th>Flaw</th>
                    <th>Time</th>
                    <th className="!text-right">Words</th>
                    <th className="!text-right">Param</th>
                  </tr>
                </thead>
                <tbody>
                  {row.labels.map((l, i) => {
                    const d = flawTypeDim(String(l.type));
                    return (
                      <tr key={i}>
                        <td>
                          <span className="flex items-center gap-1.5">
                            {d && <Swatch color={dimColor(d)} texture={cssTexture(d, 0.6)} />}
                            <span className="font-medium text-ink">{flawTypeLabel(String(l.type))}</span>
                          </span>
                          {d && <span className="ml-[18px] text-2xs text-ink-muted">{dimLabel(d)}</span>}
                        </td>
                        <td className="font-mono">
                          {fmtTime(l.t_start)}–{fmtTime(l.t_end)}
                        </td>
                        <td className="text-right font-mono">{l.words ? `${l.words[0]}–${l.words[1]}` : '—'}</td>
                        <td className="text-right font-mono">{isNum(l.param) ? fmt(l.param, l.param > 100 ? 0 : 2) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-ink-soft">Level 0 — no flaws injected. A good detector stays silent here.</p>
            )}
          </aside>
        </div>
      )}

      <section aria-labelledby="layers">
        <h2 id="layers" className="text-base font-semibold text-ink">
          Dataset layers
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          SHRUTI-Bench v0: {LAYERS.reduce((a, l) => a + l.dev + l.test, 0)} renders from six public-domain originals. Scripts S1–S4 form the dev
          split; S5–S6 are held out for the test split and never used for tuning.
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white">
          <table className="table-clean">
            <thead>
              <tr>
                <th className="!pl-4">Layer</th>
                <th>What it contains</th>
                <th>What it tests</th>
                <th className="!text-right">Dev</th>
                <th className="!text-right">Test</th>
                <th className="!pr-4 !text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {LAYERS.map((l) => (
                <tr key={l.layer}>
                  <td className="!pl-4 font-mono font-semibold text-ink">{l.layer}</td>
                  <td className="text-ink-soft">{l.what}</td>
                  <td className="text-ink-soft">{l.why}</td>
                  <td className="text-right font-mono">{l.dev}</td>
                  <td className="text-right font-mono">{l.test}</td>
                  <td className="!pr-4 text-right font-mono font-semibold">{l.dev + l.test}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
