/* /study — blind adjudicator study: human raters score clips and mark flaw moments, so SHRUTI's
 * rubric and localisation can be compared with human judges. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dimension, StudyClip, StudyMark } from '../types';
import { DIMENSIONS, FLAW_TYPES } from '../types';
import { errorMessage, getStudyClips, postStudyResponse, studyAudioUrl } from '../api';
import { useAppState, useToast } from '../lib/appState';
import { useAsync, useLocalStorage } from '../lib/useAsync';
import { DIM_BLURB, DIM_LABEL, dimColor, flawTypeDim, flawTypeLabel } from '../lib/dimensions';
import { fmtTime } from '../lib/format';
import MiniWave, { type MiniMarker, type MiniWaveHandle } from '../components/MiniWave';
import { Button, EmptyState, ErrorState, LoadingState, Notice } from '../components/ui';
import { IconArrowRight, IconCheck, IconTrash, IconUsers } from '../components/icons';

type Scores = Record<Dimension | 'overall', number>;
const initialScores = (): Scores => ({ pacing: 5, pausing: 5, intonation: 5, projection: 5, fluency: 5, clarity: 5, emphasis: 5, overall: 5 });

export default function Study() {
  const [raterId, setRaterId] = useLocalStorage('shruti.study.rater', '');
  const [draft, setDraft] = useState(raterId);
  const [started, setStarted] = useState(!!raterId);

  if (!started || !raterId)
    return (
      <div className="mx-auto max-w-xl space-y-5 py-4">
        <header>
          <h1 className="text-2xl font-semibold text-ink">Adjudicator study</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Listen to short deliveries, mark the moments where something goes wrong, and score each rubric dimension from 0 to 10 — just as
            you would judge a speaker. Clips are shown in a different random order to each rater and you won’t see SHRUTI’s output.
          </p>
        </header>
        <form
          className="rounded-lg border border-line bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const id = draft.trim().replace(/[^A-Za-z0-9_-]/g, '');
            if (!id) return;
            setRaterId(id);
            setStarted(true);
          }}
        >
          <label htmlFor="rater" className="field-label">
            Rater ID (letters, digits, - and _)
          </label>
          <input id="rater" className="field" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. judge-07" autoComplete="off" />
          <p className="mt-1 text-2xs text-ink-muted">Use the same ID every session so your progress is kept.</p>
          <Button type="submit" variant="primary" className="mt-4" disabled={!draft.trim()}>
            Start rating <IconArrowRight size={14} />
          </Button>
        </form>
      </div>
    );

  return <StudyRun raterId={raterId} onSwitch={() => setStarted(false)} />;
}

function StudyRun({ raterId, onSwitch }: { raterId: string; onSwitch: () => void }) {
  const { online, status } = useAppState();
  const q = useAsync(async () => (online ? getStudyClips(raterId) : ([] as StudyClip[])), [raterId, online]);
  const [done, setDone] = useLocalStorage<string[]>(`shruti.study.done.${raterId}`, []);
  const clips = q.data ?? [];
  const remaining = clips.filter((c) => !done.includes(c.clip_id));
  const clip = remaining[0] ?? null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Adjudicator study</h1>
          <p className="text-sm text-ink-soft">
            Rater <span className="font-mono font-semibold text-ink">{raterId}</span> ·{' '}
            <button type="button" className="link" onClick={onSwitch}>
              switch
            </button>
          </p>
        </div>
        {clips.length > 0 && (
          <div className="w-64">
            <div className="flex justify-between text-xs text-ink-soft">
              <span>Progress</span>
              <span className="font-mono num">
                {clips.length - remaining.length}/{clips.length}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-accent" style={{ width: `${((clips.length - remaining.length) / clips.length) * 100}%` }} />
            </div>
          </div>
        )}
      </header>

      {status !== 'checking' && !online ? (
        <EmptyState title="The study needs the API" icon={<IconUsers size={28} />}>
          Clips and responses are served by the SHRUTI backend. Reconnect to take part.
        </EmptyState>
      ) : q.loading ? (
        <LoadingState label="Loading clips…" />
      ) : q.error ? (
        <ErrorState title="Could not load clips" message={errorMessage(q.error)} onRetry={q.reload} />
      ) : clips.length === 0 ? (
        <EmptyState title="No clips to rate yet" icon={<IconUsers size={28} />}>
          The study organisers haven’t published clips on this server. Please check back later.
        </EmptyState>
      ) : clip == null ? (
        <EmptyState title="All done — thank you!" icon={<IconCheck size={28} />} action={
          <Button variant="secondary" onClick={() => setDone([])}>
            Rate them again
          </Button>
        }>
          You rated all {clips.length} clips. Your responses were saved on the server.
        </EmptyState>
      ) : (
        <ClipForm
          key={clip.clip_id}
          clip={clip}
          raterId={raterId}
          index={clips.length - remaining.length + 1}
          total={clips.length}
          onDone={() => setDone((d) => [...d, clip.clip_id])}
        />
      )}
    </div>
  );
}

function ClipForm({ clip, raterId, index, total, onDone }: { clip: StudyClip; raterId: string; index: number; total: number; onDone: () => void }) {
  const toast = useToast();
  const [scores, setScores] = useState<Scores>(initialScores);
  const [marks, setMarks] = useState<StudyMark[]>([]);
  const [markType, setMarkType] = useState<string>('long_pause');
  const [clickMarks, setClickMarks] = useState(true);
  const [confidence, setConfidence] = useState(3);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const wave = useRef<MiniWaveHandle>(null);

  const markers: MiniMarker[] = useMemo(
    () =>
      marks.map((m, i) => {
        const d = flawTypeDim(m.type);
        return { id: `m${i}`, t: m.t, color: d ? dimColor(d) : '#334155', label: flawTypeLabel(m.type) };
      }),
    [marks],
  );

  const addMark = (t: number) => setMarks((ms) => [...ms, { t: Math.round(t * 100) / 100, type: markType }].sort((a, b) => a.t - b.t));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'm' || e.key === 'M') addMark(wave.current?.getTime() ?? 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async () => {
    setBusy(true);
    try {
      await postStudyResponse({ rater_id: raterId, clip_id: clip.clip_id, scores, marks, confidence, comment: comment.trim() });
      toast('Response saved.', 'success');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-5">
      <section className="space-y-4 rounded-lg border border-line bg-white p-5" aria-label="Clip">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">{clip.title ?? `Clip ${index}`}</h2>
          <span className="font-mono text-xs text-ink-muted">
            {index} of {total}
          </span>
        </div>
        <MiniWave ref={wave} url={studyAudioUrl(clip.clip_id)} height={110} markers={markers} onClickTime={(t) => clickMarks && addMark(t)} />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor="mark-type" className="text-ink-soft">
            Mark type
          </label>
          <select id="mark-type" className="field h-8 w-48" value={markType} onChange={(e) => setMarkType(e.target.value)}>
            {FLAW_TYPES.map((t) => (
              <option key={t} value={t}>
                {flawTypeLabel(t)}
              </option>
            ))}
            <option value="other">Other</option>
          </select>
          <Button size="sm" variant="secondary" onClick={() => addMark(wave.current?.getTime() ?? 0)}>
            Mark at playhead <kbd className="font-mono text-2xs text-ink-muted">M</kbd>
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" className="accent-accent" checked={clickMarks} onChange={(e) => setClickMarks(e.target.checked)} />
            Clicking the waveform adds a mark
          </label>
        </div>
        {marks.length > 0 ? (
          <ul className="divide-y divide-line rounded-md border border-line">
            {marks.map((m, i) => (
              <li key={`${m.t}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="font-mono text-ink num">{fmtTime(m.t)}</span>
                <select
                  className="field h-7 w-44 text-xs"
                  value={m.type}
                  aria-label={`Type of mark at ${fmtTime(m.t)}`}
                  onChange={(e) => setMarks((ms) => ms.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                >
                  {FLAW_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {flawTypeLabel(t)}
                    </option>
                  ))}
                  <option value="other">Other</option>
                </select>
                <button
                  type="button"
                  className="ml-auto rounded p-1 text-ink-muted hover:bg-slate-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                  aria-label={`Remove mark at ${fmtTime(m.t)}`}
                  onClick={() => setMarks((ms) => ms.filter((_, j) => j !== i))}
                >
                  <IconTrash size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Notice tone="neutral">No marks yet. Play the clip and mark each moment where the delivery goes wrong (or leave empty if none).</Notice>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-line bg-white p-5" aria-label="Scores">
        <h2 className="text-sm font-semibold text-ink">Scores (0 = very poor · 10 = excellent)</h2>
        <div className="space-y-2.5">
          {[...DIMENSIONS, 'overall' as const].map((d) => (
            <div key={d} className="grid grid-cols-[96px_minmax(0,1fr)_36px] items-center gap-3">
              <label htmlFor={`s-${d}`} className="text-sm font-medium text-ink" title={d === 'overall' ? 'Your overall impression' : DIM_BLURB[d]}>
                {d === 'overall' ? 'Overall' : DIM_LABEL[d]}
              </label>
              <input
                id={`s-${d}`}
                type="range"
                className="range"
                min={0}
                max={10}
                step={0.5}
                value={scores[d]}
                onChange={(e) => setScores((s) => ({ ...s, [d]: Number(e.target.value) }))}
              />
              <span className="text-right font-mono text-sm num text-ink">{scores[d].toFixed(1)}</span>
            </div>
          ))}
        </div>
        <fieldset>
          <legend className="field-label">How confident are you?</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={confidence === c}
                onClick={() => setConfidence(c)}
                className={`h-8 flex-1 rounded-md border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                  confidence === c ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-slate-50'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-0.5 flex justify-between text-2xs text-ink-muted">
            <span>guessing</span>
            <span>certain</span>
          </div>
        </fieldset>
        <div>
          <label htmlFor="comment" className="field-label">
            Comment (optional)
          </label>
          <textarea id="comment" rows={3} className="field h-auto py-2" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" onClick={() => void submit()} loading={busy}>
            Submit and next <IconArrowRight size={14} />
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={busy}>
            Skip
          </Button>
        </div>
      </section>
    </div>
  );
}
