/* Phrase drill: loop the phrase (reference → ghost → yours), re-record just those words, and
 * re-score them in context. Keeps a per-flaw attempt history. */
import { useEffect, useState } from 'react';
import type { Analysis, DrillResponse, FlawCard } from '../../types';
import type { Player, PlayerState } from '../../lib/player';
import { postDrill, errorMessage } from '../../api';
import { prepareUpload } from '../../lib/audio';
import { useRecorder } from '../../lib/useRecorder';
import { useLocalStorage } from '../../lib/useAsync';
import { dimColor, dimLabel } from '../../lib/dimensions';
import { fmt, fmtTime } from '../../lib/format';
import LevelMeter from '../LevelMeter';
import Sparkline from '../Sparkline';
import { Badge, Button, Modal, Notice, Spinner } from '../ui';
import { IconCheck, IconMic, IconPlay, IconRepeat, IconStop, IconX } from '../icons';
import { REGION_PAD } from './FlawCardView';

interface Attempt {
  at: number;
  cleared: boolean;
  dim_after: number;
  overall_after: number;
}

export default function DrillModal({
  open,
  onClose,
  card,
  analysis,
  player,
  playerState,
}: {
  open: boolean;
  onClose: () => void;
  card: FlawCard | null;
  analysis: Analysis;
  player: Player;
  playerState: PlayerState;
}) {
  return (
    <Modal open={open && !!card} onClose={onClose} title={card ? `Practise: “${card.words}”` : 'Practise'} width="max-w-3xl">
      {card && <DrillBody key={card.id} card={card} analysis={analysis} player={player} playerState={playerState} />}
    </Modal>
  );
}

function DrillBody({
  card,
  analysis,
  player,
  playerState,
}: {
  card: FlawCard;
  analysis: Analysis;
  player: Player;
  playerState: PlayerState;
}) {
  const rec = useRecorder(30);
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<DrillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useLocalStorage<Attempt[]>(`shruti.drill.${analysis.analysis_id}.${card.id}`, []);
  const a = Math.max(0, card.t_start - REGION_PAD);
  const b = Math.min(analysis.duration_s, card.t_end + REGION_PAD);

  useEffect(() => {
    player.defaultGhost(card.id, card.t_start, card.t_end);
    return () => {
      player.pause();
      rec.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const loopSegments = () =>
    player.playSequence(
      [
        { mode: 'reference', from: a, to: b, label: 'Reference' },
        { mode: 'ghost', from: a, to: b, label: 'Ghost (fixed)', flawId: card.id },
        { mode: 'user', from: a, to: b, label: 'Yours' },
      ],
      true,
    );

  const looping = playerState.playing && playerState.segment?.loop;
  const ctxFrom = Math.max(0, card.word_span[0] - 4);
  const ctxTo = Math.min(analysis.words.length - 1, card.word_span[1] + 4);

  const startRecording = async () => {
    player.pause();
    setResult(null);
    setError(null);
    await rec.start();
  };

  const score = async () => {
    if (!rec.blob) return;
    setScoring(true);
    setError(null);
    try {
      const up = await prepareUpload(rec.blob, `drill_${card.id}`);
      const res = await postDrill(analysis.analysis_id, card.id, up.blob, up.filename);
      setResult(res);
      setHistory((h) => [...h, { at: Date.now(), cleared: res.cleared, dim_after: res.dim_after, overall_after: res.overall_after }].slice(-20));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setScoring(false);
    }
  };

  const dimBefore = analysis.rubric.dimensions[card.dimension as keyof typeof analysis.rubric.dimensions]?.score ?? null;

  return (
    <div className="space-y-5">
      {/* the phrase in context */}
      <div className="rounded-lg border border-line bg-surface-sunken px-4 py-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">The phrase</p>
        <p className="mt-1 text-xl leading-relaxed text-ink-soft">
          {ctxFrom > 0 && '… '}
          {analysis.words.slice(ctxFrom, ctxTo + 1).map((w) => {
            const hit = w.i >= card.word_span[0] && w.i <= card.word_span[1];
            return (
              <span key={w.i}>
                <span
                  className={hit ? 'rounded px-1 font-semibold text-ink' : ''}
                  style={hit ? { backgroundColor: `${dimColor(card.dimension)}33`, boxShadow: `inset 0 -2px 0 ${dimColor(card.dimension)}` } : undefined}
                >
                  {w.word}
                </span>{' '}
              </span>
            );
          })}
          {ctxTo < analysis.words.length - 1 && '…'}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          <span className="font-semibold text-ink">Target: </span>
          {card.fix}
        </p>
      </div>

      {/* 1. listen */}
      <section>
        <h3 className="text-sm font-semibold text-ink">1 · Listen</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant={looping ? 'secondary' : 'primary'} size="sm" onClick={() => (looping ? player.pause() : loopSegments())}>
            {looping ? <IconStop size={13} /> : <IconRepeat size={14} />}
            {looping ? 'Stop loop' : 'Loop: reference → ghost → yours'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => player.playRange(a, b, 'reference', 'Reference')}>
            <IconPlay size={11} /> Reference
          </Button>
          <Button size="sm" variant="ghost" onClick={() => player.playRange(a, b, 'ghost', 'Ghost (fixed)', card.id)}>
            <IconPlay size={11} /> Ghost
          </Button>
          <Button size="sm" variant="ghost" onClick={() => player.playRange(a, b, 'user', 'Yours')}>
            <IconPlay size={11} /> Yours
          </Button>
          {playerState.loading && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
              <Spinner size={12} /> {playerState.loading}
            </span>
          )}
          {playerState.playing && playerState.segment && (
            <span className="text-xs font-medium text-accent" aria-live="polite">
              ▶ {playerState.segment.label}
            </span>
          )}
        </div>
      </section>

      {/* 2. record */}
      <section>
        <h3 className="text-sm font-semibold text-ink">2 · Record just this phrase</h3>
        <div className="mt-2 flex items-center gap-3">
          {rec.status === 'recording' ? (
            <Button variant="danger" onClick={() => void rec.stop()}>
              <IconStop size={13} /> Stop · {rec.elapsed.toFixed(1)} s
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void startRecording()} disabled={!rec.supported} hint={rec.supported ? undefined : 'Microphone recording is not supported in this browser'}>
              <IconMic size={15} /> {rec.blob ? 'Record again' : 'Record'}
            </Button>
          )}
          <div className="w-56">
            <LevelMeter getLevel={rec.getLevel} active={rec.status === 'recording' || rec.status === 'monitoring'} />
          </div>
          {rec.url && rec.status !== 'recording' && <audio src={rec.url} controls className="h-9" aria-label="Your new attempt" />}
        </div>
        {rec.error && <Notice className="mt-2">{rec.error}</Notice>}
        {rec.blob && rec.status !== 'recording' && (
          <div className="mt-3">
            <Button variant="primary" onClick={() => void score()} loading={scoring}>
              {scoring ? 'Re-scoring in context…' : 'Score this attempt'}
            </Button>
          </div>
        )}
        {error && <Notice className="mt-2">{error}</Notice>}
      </section>

      {/* 3. result */}
      {result && (
        <section className="rounded-lg border border-line px-4 py-3" aria-live="polite">
          <div className="flex items-center gap-2">
            {result.cleared ? (
              <Badge tone="green">
                <IconCheck size={12} strokeWidth={3} /> Flag cleared
              </Badge>
            ) : (
              <Badge tone="amber">
                <IconX size={12} strokeWidth={3} /> Not cleared yet
              </Badge>
            )}
            <span className="text-sm text-ink-soft">
              {result.cleared ? 'The detector no longer flags this phrase.' : `${result.remaining.length} flag(s) still overlap these words.`}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ScoreDelta label={dimLabel(result.dimension)} before={result.dim_before} after={result.dim_after} color={dimColor(result.dimension)} />
            <ScoreDelta label="Overall" before={result.overall_before} after={result.overall_after} color="#3730a3" />
          </div>
          {result.remaining.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
              {result.remaining.map((r) => (
                <li key={r.id}>
                  {r.title} · {fmtTime(r.t_start)}–{fmtTime(r.t_end)} · {r.headline}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* history */}
      {history.length > 0 && (
        <section className="flex items-center justify-between gap-4 rounded-lg border border-line bg-surface-sunken px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Attempt history</h3>
            <p className="text-xs text-ink-muted">
              {history.length} attempt{history.length === 1 ? '' : 's'} · {history.filter((h) => h.cleared).length} cleared · dashed line = score
              before drilling
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Sparkline values={history.map((h) => h.dim_after)} baseline={dimBefore ?? undefined} width={160} height={36} />
            <span className="font-mono text-sm num text-ink">{fmt(history[history.length - 1].dim_after, 1)}</span>
            <Button size="xs" variant="ghost" onClick={() => setHistory([])}>
              Clear
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ScoreDelta({ label, before, after, color }: { label: string; before: number; after: number; color: string }) {
  const d = after - before;
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2 num">
        <span className="text-ink-muted line-through decoration-slate-300">{fmt(before, 2)}</span>
        <span className="text-ink-muted">→</span>
        <span className="text-lg font-semibold text-ink">{fmt(after, 2)}</span>
        <span className={`text-xs font-medium ${d > 0.005 ? 'text-emerald-700' : d < -0.005 ? 'text-red-700' : 'text-ink-muted'}`}>
          {d >= 0 ? '+' : '−'}
          {fmt(Math.abs(d), 2)}
        </span>
      </div>
    </div>
  );
}
