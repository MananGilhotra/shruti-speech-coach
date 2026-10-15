/* Analysis header pieces: overall score, fingerprint chip, keyboard shortcut help, measurement strip. */
import { useState } from 'react';
import type { Analysis, Fingerprint } from '../../types';
import { fmt, fmtP, shortHash } from '../../lib/format';
import { IconCheck, IconCopy, IconFingerprint, IconKeyboard } from '../icons';
import { Kbd, Popover } from '../ui';

export function FingerprintChip({ fp, version }: { fp: Fingerprint; version?: string }) {
  const [copied, setCopied] = useState(false);
  const rows: [string, string][] = [
    ['Analysis id', fp.id],
    ['Audio SHA-256', fp.audio_sha256],
    ['Config hash', fp.config],
    ['Aligner model', fp.model],
    ['Code version', fp.code],
    ['Baseline', fp.baseline],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (version ? `\nSchema: ${version}` : '');
  return (
    <Popover
      label="Reproducibility fingerprint"
      trigger={(open) => (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-2xs ${
            open ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:border-line-strong'
          }`}
        >
          <IconFingerprint size={13} /> {shortHash(fp.id, 10)}
        </span>
      )}
    >
      <div className="w-[380px]">
        <p className="text-xs font-semibold text-ink">Reproducibility fingerprint</p>
        <p className="mt-0.5 text-2xs text-ink-muted">
          Same audio + config + model + code ⇒ the same analysis, bit for bit. Quote this when reporting a result.
        </p>
        <dl className="mt-2 grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-1 text-2xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="break-all font-mono text-ink">{v || '—'}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-2xs font-medium text-ink-soft hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />} {copied ? 'Copied' : 'Copy all'}
        </button>
      </div>
    </Popover>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['J / K', 'Previous / next flaw'],
  ['G', 'Ghost: hear the selected flaw fixed'],
  ['R', 'Reference: hear the original orator here'],
  ['Y', 'Back to your own take'],
  ['D', 'Duet: you + time-warped reference'],
  ['+ / −', 'Zoom in / out'],
  ['0', 'Show the whole take'],
  ['Ctrl/⌘ + scroll', 'Zoom around the cursor'],
  ['Shift + scroll', 'Scroll in time'],
  ['?', 'Show this help'],
];

export function ShortcutsHelp({ open, onOpenChange }: { open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      label="Keyboard shortcuts"
      trigger={(o) => (
        <span
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
            o ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-white text-ink-soft hover:bg-slate-50'
          }`}
        >
          <IconKeyboard size={15} /> Shortcuts
        </span>
      )}
    >
      <table className="text-xs">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td className="py-1 pr-4">
                <Kbd>{k}</Kbd>
              </td>
              <td className="py-1 text-ink-soft">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Popover>
  );
}

export function ScoreDial({ score, max = 10, label }: { score: number; max?: number; label: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / max));
  return (
    <div className="flex items-center gap-3">
      <svg width={76} height={76} viewBox="0 0 76 76" role="img" aria-label={`${label}: ${fmt(score, 1)} out of ${max}`}>
        <circle cx={38} cy={38} r={r} fill="none" stroke="#e0e7ff" strokeWidth={7} />
        <circle
          cx={38}
          cy={38}
          r={r}
          fill="none"
          stroke="#3730a3"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 38 38)"
        />
        <text x={38} y={43} textAnchor="middle" fontSize={20} fontWeight={700} fill="#0f172a" className="num">
          {fmt(score, 1)}
        </text>
      </svg>
      <div>
        <div className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
        <div className="text-sm text-ink-soft">
          out of <span className="num">{max}</span>
        </div>
      </div>
    </div>
  );
}

export function MeasurementStrip({ analysis }: { analysis: Analysis }) {
  const t = analysis.tests;
  const fams = Object.entries(t.by_family ?? {}).sort((a, b) => b[1] - a[1]);
  const maxFam = Math.max(1, ...fams.map(([, n]) => n));
  return (
    <section aria-labelledby="how-measured" className="rounded-lg border border-line bg-white">
      <div className="grid grid-cols-1 gap-6 px-5 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <h2 id="how-measured" className="text-sm font-semibold text-ink">
            How this was measured
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
            Every word window was compared with the reference delivery: <strong className="num text-ink">{t.n_tests}</strong> hypotheses
            were tested (Student-t, df = <span className="num">{fmt(t.df, 0)}</span>), and{' '}
            <strong className="num text-ink">{t.n_flagged}</strong> {t.n_flagged === 1 ? 'was' : 'were'} flagged while controlling the
            false-discovery rate at <strong className="num text-ink">q = {t.fdr_q}</strong> (Benjamini–Hochberg). The baseline is{' '}
            <strong className="num text-ink">{analysis.reference.n_refs}</strong> reference take
            {analysis.reference.n_refs === 1 ? '' : 's'} ({analysis.reference.ref_ids.join(', ') || '—'}); flag boundaries carry bootstrap
            confidence intervals. Mode: {analysis.mode}.
          </p>
          <p className="mt-2 font-mono text-2xs text-ink-muted">
            rubric: {analysis.rubric.formula} · speaking time T = {fmt(analysis.rubric.speaking_s, 1)} s
          </p>
          <p className="mt-1 font-mono text-2xs text-ink-muted">
            fingerprint {analysis.fingerprint.id} · audio {shortHash(analysis.fingerprint.audio_sha256, 16)} · config{' '}
            {analysis.fingerprint.config} · {analysis.fingerprint.model} · code {analysis.fingerprint.code}
            {analysis.elapsed_s != null && ` · computed in ${fmt(analysis.elapsed_s, 1)} s`}
          </p>
        </div>
        <div>
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Hypotheses per test family</h3>
          <ul className="mt-2 space-y-1">
            {fams.map(([f, n]) => (
              <li key={f} className="grid grid-cols-[84px_minmax(0,1fr)_36px] items-center gap-2 text-xs">
                <span className="text-ink-soft">{f}</span>
                <span className="h-2 rounded-r bg-slate-200" aria-hidden="true">
                  <span className="block h-2 rounded-r bg-slate-500" style={{ width: `${(n / maxFam) * 100}%` }} />
                </span>
                <span className="text-right font-mono num text-ink">{n}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-ink-muted">
            Rejected at FDR: {t.n_rejected} · flagged regions: {t.n_flagged} · smallest q in this take:{' '}
            {fmtP(Math.min(...analysis.cards.map((c) => c.stats.q), 1))}
          </p>
        </div>
      </div>
    </section>
  );
}
