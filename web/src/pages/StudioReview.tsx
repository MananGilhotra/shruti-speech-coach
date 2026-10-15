/* /studio/review — reviewers verify Flaw Studio takes and adjust the proposed label boundaries. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StudioTake } from '../types';
import { errorMessage, getTakes, postReview, takeAudioUrl } from '../api';
import { useAppState, useToast } from '../lib/appState';
import { useAsync, useLocalStorage } from '../lib/useAsync';
import { useScripts } from '../lib/data';
import { dimColor, flawTypeDim, flawTypeLabel } from '../lib/dimensions';
import { fmt, fmtSec } from '../lib/format';
import MiniWave, { type MiniWaveHandle, type MiniRegion } from '../components/MiniWave';
import ScriptText from '../components/ScriptText';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Notice, Segmented } from '../components/ui';
import { IconCheck, IconChevronLeft, IconPlay, IconRefresh, IconX } from '../components/icons';

type Filter = 'pending' | 'accepted' | 'rejected' | 'all';

function statusTone(s: string) {
  return s === 'accepted' ? 'green' : s === 'rejected' ? 'red' : 'amber';
}

export default function StudioReview() {
  const { online, status } = useAppState();
  const { data, error, loading, reload } = useAsync(async () => (online ? getTakes() : ([] as StudioTake[])), [online]);
  const [filter, setFilter] = useState<Filter>('pending');
  const [selected, setSelected] = useState<string | null>(null);
  const takes = useMemo(() => (data ?? []).slice().sort((a, b) => (b.uploaded ?? 0) - (a.uploaded ?? 0)), [data]);
  const shown = takes.filter((t) => filter === 'all' || t.status === filter);
  const current = takes.find((t) => t.take_id === selected) ?? shown[0] ?? null;
  const counts = { pending: 0, accepted: 0, rejected: 0 } as Record<string, number>;
  takes.forEach((t) => (counts[t.status] = (counts[t.status] ?? 0) + 1));

  return (
    <div className="space-y-5">
      <Link to="/studio" className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink">
        <IconChevronLeft size={13} /> Flaw Studio
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Review uploaded takes</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            Listen to each take, check the instructed flaw is really there, and correct the label boundaries if the automatic proposal (from
            forced alignment of the instructed words) is off. Only accepted takes enter the dataset.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={reload} disabled={!online}>
          <IconRefresh size={13} /> Refresh
        </Button>
      </header>

      {status !== 'checking' && !online && <Notice tone="amber">The API is offline, so there are no takes to review.</Notice>}
      {error ? <ErrorState title="Could not load takes" message={errorMessage(error)} onRetry={reload} /> : null}

      {loading ? (
        <LoadingState label="Loading takes…" />
      ) : takes.length === 0 ? (
        online && (
          <EmptyState title="No takes yet">
            When volunteers upload recordings in the <Link to="/studio" className="link">Flaw Studio</Link>, they appear here for review.
          </EmptyState>
        )
      ) : (
        <div className="grid grid-cols-[360px_minmax(0,1fr)] items-start gap-5">
          <aside className="rounded-lg border border-line bg-white">
            <div className="border-b border-line p-3">
              <Segmented<Filter>
                label="Filter by status"
                size="xs"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'pending', label: `Pending (${counts.pending ?? 0})` },
                  { value: 'accepted', label: `Accepted (${counts.accepted ?? 0})` },
                  { value: 'rejected', label: `Rejected (${counts.rejected ?? 0})` },
                  { value: 'all', label: 'All' },
                ]}
              />
            </div>
            <ul className="max-h-[70vh] overflow-y-auto p-2">
              {shown.length === 0 && <li className="px-2 py-6 text-center text-xs text-ink-muted">Nothing here.</li>}
              {shown.map((t) => (
                <li key={t.take_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.take_id)}
                    className={`w-full rounded-md px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                      current?.take_id === t.take_id ? 'bg-accent-soft' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {t.kind === 'good' ? 'Best delivery' : flawTypeLabel(t.instruction?.type ?? 'flaw')}
                      </span>
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    </div>
                    <div className="mt-0.5 font-mono text-2xs text-ink-muted">
                      {t.speaker_id} · {t.script_id} · {fmtSec(t.duration_s, 1)}
                      {t.uploaded ? ` · ${new Date(t.uploaded * 1000).toLocaleString()}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          {current ? <ReviewPanel key={current.take_id} take={current} onReviewed={reload} /> : <Notice tone="neutral">Select a take.</Notice>}
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ take, onReviewed }: { take: StudioTake; onReviewed: () => void }) {
  const toast = useToast();
  const { scripts } = useScripts();
  const [reviewer, setReviewer] = useLocalStorage('shruti.reviewer', '');
  const [note, setNote] = useState('');
  const initial = take.label ?? take.proposed_label ?? null;
  const [label, setLabel] = useState<{ t_start: number; t_end: number } | null>(initial);
  // bumped whenever the label is set programmatically, so the waveform region is redrawn
  const [labelRev, setLabelRev] = useState(0);
  const setLabelAndRegion = (l: { t_start: number; t_end: number } | null) => {
    setLabel(l);
    setLabelRev((r) => r + 1);
  };
  const [busy, setBusy] = useState<null | 'accepted' | 'rejected'>(null);
  const wave = useRef<MiniWaveHandle>(null);
  const ins = take.instruction;
  const dim = flawTypeDim(ins?.type ?? '');
  const color = dim ? dimColor(dim) : '#3730a3';
  const script = scripts.find((s) => s.script_id === take.script_id);

  useEffect(() => setLabelAndRegion(initial), [take.take_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const regions: MiniRegion[] = useMemo(
    () =>
      label && take.kind !== 'good'
        ? [{ id: 'label', start: label.t_start, end: label.t_end, color, dimension: dim ?? undefined, label: 'label (drag edges)', editable: true }]
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [take.take_id, labelRev, color, dim],
  );

  const review = async (verdict: 'accepted' | 'rejected') => {
    if (!reviewer.trim()) {
      toast('Enter your reviewer name first.', 'error');
      return;
    }
    setBusy(verdict);
    try {
      await postReview(take.take_id, { verdict, reviewer: reviewer.trim(), label: label ?? undefined, note: note.trim() || undefined });
      toast(`Take ${verdict}.`, 'success');
      onReviewed();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-line bg-white p-5" aria-label="Review take">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="accent">{take.script_id}</Badge>
            <Badge tone={statusTone(take.status)}>{take.status}</Badge>
            {take.kind !== 'good' && (
              <Badge tone="amber">
                {flawTypeLabel(ins?.type ?? '')}
                {ins?.severity ? ` · ${ins.severity}` : ''}
              </Badge>
            )}
          </div>
          <h2 className="mt-1 font-mono text-sm text-ink">{take.take_id}</h2>
        </div>
        <div className="text-right text-2xs text-ink-muted">
          {take.asr_wer != null && <div>ASR WER {Math.round(take.asr_wer * 100)}%</div>}
          {take.sha256 && <div className="font-mono">sha256 {take.sha256.slice(0, 12)}</div>}
        </div>
      </div>

      {ins?.text && (
        <div className="rounded-md border-l-4 border-amber-600 bg-amber-50 px-3 py-2 text-sm text-ink">
          <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Instruction · </span>
          {ins.text}
        </div>
      )}
      {script && (
        <div className="rounded-md border border-line bg-surface-sunken px-4 py-3">
          <ScriptText transcript={script.transcript} instruction={take.kind === 'good' ? undefined : ins} className="text-sm text-ink-soft" />
        </div>
      )}

      <MiniWave
        ref={wave}
        url={takeAudioUrl(take.take_id)}
        height={96}
        regions={regions}
        onRegionChange={(_id, start, end) => setLabel({ t_start: start, t_end: end })}
      />

      {take.kind !== 'good' && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-soft">
            Label:{' '}
            {label ? (
              <span className="font-mono text-ink">
                {fmt(label.t_start)}–{fmt(label.t_end)} s
              </span>
            ) : (
              <span className="text-ink-muted">none proposed{take.alignment_error ? ` (alignment failed: ${take.alignment_error})` : ''}</span>
            )}
          </span>
          {label && (
            <Button size="xs" variant="secondary" onClick={() => wave.current?.play(Math.max(0, label.t_start - 0.5), label.t_end + 0.5)}>
              <IconPlay size={11} /> Play label ± 0.5 s
            </Button>
          )}
          {take.proposed_label && label && (label.t_start !== take.proposed_label.t_start || label.t_end !== take.proposed_label.t_end) && (
            <Button size="xs" variant="ghost" onClick={() => setLabelAndRegion(take.proposed_label ?? null)}>
              Reset to proposal
            </Button>
          )}
          {!label && (
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                const t = wave.current?.getTime() ?? 0;
                setLabelAndRegion({ t_start: Math.max(0, t - 0.5), t_end: t + 0.5 });
              }}
            >
              Add label at playhead
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-3">
        <div>
          <label htmlFor="reviewer" className="field-label">
            Reviewer name
          </label>
          <input id="reviewer" className="field" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. rev-anika" />
        </div>
        <div>
          <label htmlFor="note" className="field-label">
            Note (optional)
          </label>
          <input id="note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. flaw too subtle; background noise" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="success" onClick={() => void review('accepted')} loading={busy === 'accepted'} disabled={busy != null}>
          <IconCheck size={14} /> Accept
        </Button>
        <Button variant="danger" onClick={() => void review('rejected')} loading={busy === 'rejected'} disabled={busy != null}>
          <IconX size={14} /> Reject
        </Button>
        {take.reviews && take.reviews.length > 0 && (
          <span className="ml-auto text-2xs text-ink-muted">
            {take.reviews.length} previous review{take.reviews.length === 1 ? '' : 's'} · last by {take.reviews[take.reviews.length - 1].reviewer}
          </span>
        )}
      </div>
    </section>
  );
}
