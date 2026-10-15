/* /analysis/:id — the core screen: where the delivery broke, why, and how it sounds fixed. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Analysis, Dimension, FlawCard } from '../types';
import { DIMENSIONS } from '../types';
import { analysisAudioUrl, getAnalysis, SAMPLE_ID } from '../api';
import { useAppState, useToast } from '../lib/appState';
import { useAsync } from '../lib/useAsync';
import { MODE_LABEL, Player, referenceMap, type PlayMode, type PlayerState } from '../lib/player';
import { cssTexture, dimColor, dimLabel } from '../lib/dimensions';
import { fmt, fmtTime, isNum } from '../lib/format';
import Timeline, { type TimelineHandle } from '../components/timeline/Timeline';
import FlawCardView, { REGION_PAD, type GhostState } from '../components/analysis/FlawCardView';
import DrillModal from '../components/analysis/DrillModal';
import DemoBanner from '../components/analysis/DemoBanner';
import { DimensionBars, RubricRadar } from '../components/analysis/Rubric';
import { FingerprintChip, MeasurementStrip, ScoreDial, ShortcutsHelp } from '../components/analysis/Header';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Notice, Segmented, Spinner, Stat, Swatch } from '../components/ui';
import { IconAlert, IconCheck, IconPause, IconPlay, IconTarget } from '../components/icons';

export default function AnalysisPage() {
  const { id = SAMPLE_ID } = useParams();
  const { status, online } = useAppState();
  if (status === 'checking') return <LoadingState label="Connecting to the SHRUTI API…" />;
  return <AnalysisLoader key={`${id}|${online}`} id={id} online={online} />;
}

function AnalysisLoader({ id, online }: { id: string; online: boolean }) {
  const { data, error, loading, reload } = useAsync(() => getAnalysis(id, online), [id, online]);
  if (loading) return <LoadingState label="Loading analysis…" />;
  if (error || !data)
    return (
      <div className="mx-auto max-w-2xl py-10">
        <ErrorState
          title="This analysis could not be loaded"
          message={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={reload}
        />
        <p className="mt-4 text-sm text-ink-soft">
          You can still open the{' '}
          <Link to="/analysis/sample" className="link">
            bundled sample analysis
          </Link>{' '}
          or <Link to="/analyse" className="link">analyse a new delivery</Link>.
        </p>
      </div>
    );
  return <AnalysisView analysis={data.analysis} source={data.source} />;
}

type AudioState = 'loading' | 'ready' | 'unavailable';

function AnalysisView({ analysis, source }: { analysis: Analysis; source: 'api' | 'fixture' }) {
  const toast = useToast();
  const [player, setPlayer] = useState<Player | null>(null);
  useEffect(() => {
    const p = new Player(
      analysis.analysis_id,
      analysis.duration_s,
      referenceMap(analysis.words, analysis.reference?.word_spans),
      false,
      (msg) => toast(msg, 'error'),
    );
    setPlayer(p);
    return () => p.destroy();
  }, [analysis, toast]);

  if (!player) return <LoadingState />;
  return <AnalysisScreen analysis={analysis} source={source} player={player} />;
}

function AnalysisScreen({ analysis, source, player }: { analysis: Analysis; source: 'api' | 'fixture'; player: Player }) {
  const ps: PlayerState = useSyncExternalStore(player.subscribe, player.getState, player.getState);
  const [audioState, setAudioState] = useState<AudioState>(source === 'api' ? 'loading' : 'unavailable');
  const [audioMsg, setAudioMsg] = useState<string | null>(null);
  const audioEnabled = source === 'api' && audioState === 'ready';
  const audioHint =
    source === 'fixture'
      ? 'Audio needs the SHRUTI API (this is the bundled offline sample)'
      : audioState === 'loading'
        ? 'Loading audio…'
        : 'Audio is unavailable for this analysis';

  useEffect(() => player.setEnabled(audioEnabled), [player, audioEnabled]);
  useEffect(() => {
    if (audioEnabled) player.prefetch('reference');
  }, [player, audioEnabled]);

  const cards = useMemo(() => [...analysis.cards].sort((a, b) => a.t_start - b.t_start), [analysis.cards]);
  const [dimFilter, setDimFilter] = useState<string | 'all'>('all');
  const shownCards = useMemo(() => (dimFilter === 'all' ? cards : cards.filter((c) => c.dimension === dimFilter)), [cards, dimFilter]);
  const [selectedId, setSelectedId] = useState<string | null>(cards[0]?.id ?? null);
  const [highlightDim, setHighlightDim] = useState<Dimension | null>(null);
  const [ghosts, setGhosts] = useState<Record<string, GhostState>>({});
  const [drillId, setDrillId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const timelineRef = useRef<TimelineHandle>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const listRef = useRef<HTMLDivElement>(null);
  /** Bring a card to the top of the card list without scrolling the page. */
  const revealCard = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = cardEls.current.get(id);
      const list = listRef.current;
      if (!el || !list) return;
      const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 12;
      list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  }, []);

  // the ghost track follows the selected card
  useEffect(() => {
    if (!selectedId) return;
    const c = cards.find((x) => x.id === selectedId);
    if (c) player.defaultGhost(c.id, c.t_start, c.t_end);
    player.setGhostFlaw(selectedId);
  }, [selectedId, cards, player]);

  const onAudioState = useCallback((s: AudioState, msg?: string) => {
    setAudioState(s);
    setAudioMsg(msg ?? null);
  }, []);

  const focusCard = useCallback(
    (id: string, opts: { play?: boolean; zoom?: boolean } = {}) => {
      const c = cards.find((x) => x.id === id);
      if (!c) return;
      setSelectedId(id);
      setDimFilter((f) => (f === 'all' || f === c.dimension ? f : 'all'));
      if (opts.zoom !== false) timelineRef.current?.zoomTo(c.t_start - 1, c.t_end + 1);
      revealCard(id);
      if (opts.play !== false && player.state.enabled) {
        const a = Math.max(0, c.t_start - REGION_PAD);
        const b = Math.min(analysis.duration_s, c.t_end + REGION_PAD);
        const mode = player.state.mode;
        player.playRange(a, b, mode, MODE_LABEL[mode], mode === 'ghost' ? c.id : undefined);
      }
    },
    [cards, player, analysis.duration_s, revealCard],
  );

  const selectFromTimeline = useCallback(
    (id: string) => {
      setSelectedId(id);
      setDimFilter('all');
      revealCard(id);
    },
    [revealCard],
  );

  const playSelectedIn = useCallback(
    (mode: PlayMode) => {
      const c = cards.find((x) => x.id === selectedId);
      if (mode === 'ghost' && !c) {
        player.setMode('ghost');
        return;
      }
      if (c && player.state.enabled) {
        const a = Math.max(0, c.t_start - REGION_PAD);
        const b = Math.min(analysis.duration_s, c.t_end + REGION_PAD);
        timelineRef.current?.zoomTo(c.t_start - 1, c.t_end + 1);
        player.playRange(a, b, mode, MODE_LABEL[mode], mode === 'ghost' ? c.id : undefined);
      } else {
        player.setMode(mode);
      }
    },
    [cards, selectedId, player, analysis.duration_s],
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const idx = cards.findIndex((c) => c.id === selectedId);
      switch (e.key) {
        case ' ':
          // Space is play/pause everywhere except text fields (Enter still activates a focused button)
          e.preventDefault();
          if (tag === 'BUTTON' || tag === 'A') el?.blur();
          player.toggle();
          break;
        case 'j':
        case 'J':
          if (cards.length) focusCard(cards[Math.max(0, idx <= 0 ? 0 : idx - 1)].id);
          break;
        case 'k':
        case 'K':
          if (cards.length) focusCard(cards[Math.min(cards.length - 1, idx + 1)].id);
          break;
        case 'g':
        case 'G':
          playSelectedIn('ghost');
          break;
        case 'r':
        case 'R':
          playSelectedIn('reference');
          break;
        case 'y':
        case 'Y':
          player.setMode('user');
          break;
        case 'd':
        case 'D':
          player.setMode('duet');
          break;
        case '+':
        case '=':
          timelineRef.current?.zoomBy(1.6);
          break;
        case '-':
        case '_':
          timelineRef.current?.zoomBy(1 / 1.6);
          break;
        case '0':
          timelineRef.current?.fit();
          break;
        case '?':
          setHelpOpen((o) => !o);
          break;
        case 'Escape':
          player.pause();
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cards, selectedId, player, focusCard, playSelectedIn]);

  const onGhost = useCallback((id: string, g: GhostState) => setGhosts((m) => ({ ...m, [id]: g })), []);
  const audioUrl = source === 'api' ? analysisAudioUrl(analysis.analysis_id, 'user') : null;
  const drillCard = cards.find((c) => c.id === drillId) ?? null;
  const dimsWithCards = DIMENSIONS.filter((d) => cards.some((c) => c.dimension === d));
  const s = analysis.summary;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- header */}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            {analysis.script.script_id && <Badge tone="accent">{analysis.script.script_id}</Badge>}
            <Badge tone="neutral" title="How the expected delivery was built">
              {analysis.mode}
            </Badge>
            {source === 'fixture' && (
              <Badge tone="amber" title="Bundled with the dashboard; audio requires the API">
                Sample · offline
              </Badge>
            )}
            <FingerprintChip fp={analysis.fingerprint} version={analysis.version} />
            {analysis.script.script_id && (
              <Link
                to={`/analyse/${analysis.script.script_id}`}
                className="ml-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                Record another take →
              </Link>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight text-ink">{analysis.script.title}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Script by <span className="font-medium text-ink">{analysis.script.speaker}</span> · your take{' '}
            <span className="num">{fmt(analysis.duration_s, 1)} s</span> · speaking <span className="num">{fmt(analysis.rubric.speaking_s, 1)} s</span> ·{' '}
            {cards.length === 0 ? 'no flaws flagged' : `${cards.length} flaw${cards.length === 1 ? '' : 's'} flagged`}
          </p>
          {(analysis.style.notes?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm text-ink-soft">
              {analysis.style.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-ink-faint" aria-hidden="true">
                    •
                  </span>
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-6">
          <ScoreDial score={analysis.rubric.overall} label="Overall delivery" />
          <div className="border-l border-line pl-6">
            <div className="text-2xs font-semibold uppercase tracking-wide text-ink-muted" title="World Schools Debating style mark (out of 40)">
              WSDC style
            </div>
            <div className="mt-0.5 text-2xl font-semibold text-ink num">
              {fmt(analysis.rubric.wsdc_style, 1)}
              <span className="text-base font-normal text-ink-muted"> / 40</span>
            </div>
            <div className="text-2xs text-ink-muted">
              tempo ×{fmt(analysis.style.tempo_factor, 2)} · pitch range {isNum(analysis.style.pitch_range_ratio) ? `${Math.round(analysis.style.pitch_range_ratio * 100)}%` : '—'}
            </div>
          </div>
        </div>
      </header>

      <DemoBanner analysis={analysis} cards={cards} onFocusCard={(id) => focusCard(id)} />

      {analysis.quality.warning && (
        <Notice tone="amber" className="flex items-start gap-2">
          <IconAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>Recording quality: </strong>
            {analysis.quality.warning}
          </span>
        </Notice>
      )}
      {source === 'api' && audioState === 'unavailable' && audioMsg && (
        <Notice tone="neutral">Audio for this analysis could not be loaded ({audioMsg}); the timeline shows the loudness envelope instead.</Notice>
      )}

      {/* ---------------------------------------------------------------- main grid */}
      <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0 space-y-4">
          <Transport
            player={player}
            ps={ps}
            analysis={analysis}
            audioEnabled={audioEnabled}
            audioState={audioState}
            audioHint={audioHint}
            selectedCard={cards.find((c) => c.id === selectedId) ?? null}
            onPlaySelectedIn={playSelectedIn}
            helpOpen={helpOpen}
            onHelpOpenChange={setHelpOpen}
          />
          <Timeline
            ref={timelineRef}
            analysis={analysis}
            player={player}
            audioUrl={audioUrl}
            cards={cards}
            selectedId={selectedId}
            highlightDim={highlightDim}
            onSelectCard={selectFromTimeline}
            onAudioState={onAudioState}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-lg border border-line bg-white px-4 py-3" aria-labelledby="rubric-title">
              <div className="flex items-baseline justify-between">
                <h2 id="rubric-title" className="text-sm font-semibold text-ink">
                  Rubric
                </h2>
                <span className="text-2xs text-ink-muted">Hover a dimension to light up its flaws · click for the cost</span>
              </div>
              <div className="mt-1 flex flex-col items-center gap-2 2xl:flex-row 2xl:items-start">
                <RubricRadar rubric={analysis.rubric} highlightDim={highlightDim} onHighlight={setHighlightDim} size={272} />
                <div className="w-full min-w-0 flex-1 pt-1">
                  <DimensionBars
                    rubric={analysis.rubric}
                    cards={cards}
                    highlightDim={highlightDim}
                    onHighlight={setHighlightDim}
                    onFocusCard={(id) => focusCard(id)}
                  />
                </div>
              </div>
            </section>
            <section className="space-y-3" aria-label="Delivery summary">
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                <Stat label="Articulation rate" value={fmt(s.articulation_rate, 2)} unit="syl/s" hint="excluding pauses" />
                <Stat label="Speech rate" value={fmt(s.speech_rate, 2)} unit="syl/s" hint="including pauses" />
                <Stat label="Median pitch" value={fmt(s.f0_median_hz, 0)} unit="Hz" hint={`range ${fmt(s.f0_range_st, 1)} st`} />
                <Stat label="Pauses" value={isNum(s.n_pauses) ? s.n_pauses : '—'} hint={`${fmt(s.total_pause_s, 1)} s in total`} />
                <Stat
                  label="ASR check"
                  value={isNum(analysis.quality.asr_wer) ? `${Math.round(analysis.quality.asr_wer * 100)}%` : '—'}
                  unit="WER"
                  hint="recogniser vs. script"
                />
                <Stat label="Words aligned" value={isNum(s.n_words) ? s.n_words : analysis.words.length} hint={`${s.n_syl ?? '—'} syllables`} />
              </div>
              <div className="rounded-lg border border-line bg-white px-4 py-3 text-xs leading-relaxed text-ink-soft">
                <p className="font-semibold text-ink">Reading the timeline</p>
                <p className="mt-1">
                  Indigo is <span className="font-medium text-accent">you</span>; amber is what the{' '}
                  <span className="font-medium text-amber-800">reference delivery</span> does on the same words (mean ± 1 SD). Hatched bands are
                  flagged regions — each pattern is a rubric dimension — and they span every lane so you can see which feature broke. Hover anywhere
                  for exact values; click to seek.
                </p>
              </div>
            </section>
          </div>
        </div>

        {/* ---------------------------------------------------------------- flaw cards */}
        <aside
          className="sticky top-[4.25rem] flex max-h-[calc(100vh-5.25rem)] flex-col overflow-hidden rounded-lg border border-line bg-surface-sunken"
          aria-label="Flaw cards"
        >
          <div className="border-b border-line bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">
                Flaw cards <span className="font-normal text-ink-muted num">({shownCards.length})</span>
              </h2>
              <span className="text-2xs text-ink-muted">
                <kbd className="font-mono">J</kbd>/<kbd className="font-mono">K</kbd> to step
              </span>
            </div>
            {dimsWithCards.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filter by dimension">
                <FilterChip active={dimFilter === 'all'} onClick={() => setDimFilter('all')}>
                  All
                </FilterChip>
                {dimsWithCards.map((d) => (
                  <FilterChip key={d} active={dimFilter === d} onClick={() => setDimFilter(d)}>
                    <Swatch color={dimColor(d)} texture={cssTexture(d, 0.6)} /> {dimLabel(d)}
                  </FilterChip>
                ))}
              </div>
            )}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {cards.length === 0 ? (
              <EmptyState title="No flaws flagged" icon={<IconCheck size={28} />}>
                None of the {analysis.tests.n_tests} tests crossed the false-discovery threshold (q = {analysis.tests.fdr_q}). Your delivery
                matches the reference within its natural variation.
              </EmptyState>
            ) : (
              shownCards.map((c: FlawCard) => (
                <FlawCardView
                  key={c.id}
                  ref={(el) => {
                    if (el) cardEls.current.set(c.id, el);
                    else cardEls.current.delete(c.id);
                  }}
                  card={c}
                  selected={c.id === selectedId}
                  dimmed={highlightDim != null && highlightDim !== c.dimension}
                  speakingS={analysis.rubric.speaking_s}
                  duration={analysis.duration_s}
                  analysisId={analysis.analysis_id}
                  player={player}
                  playerState={ps}
                  audioEnabled={audioEnabled}
                  audioHint={audioHint}
                  ghost={ghosts[c.id]}
                  onGhost={onGhost}
                  onFocus={() => focusCard(c.id)}
                  onPractise={() => {
                    player.pause();
                    setDrillId(c.id);
                  }}
                />
              ))
            )}
          </div>
        </aside>
      </div>

      <MeasurementStrip analysis={analysis} />

      <DrillModal open={drillId != null} onClose={() => setDrillId(null)} card={drillCard} analysis={analysis} player={player} playerState={ps} />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
        active ? 'border-indigo-300 bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------------------------- transport bar
function Transport({
  player,
  ps,
  analysis,
  audioEnabled,
  audioState,
  audioHint,
  selectedCard,
  onPlaySelectedIn,
  helpOpen,
  onHelpOpenChange,
}: {
  player: Player;
  ps: PlayerState;
  analysis: Analysis;
  audioEnabled: boolean;
  audioState: AudioState;
  audioHint: string;
  selectedCard: FlawCard | null;
  onPlaySelectedIn: (m: PlayMode) => void;
  helpOpen: boolean;
  onHelpOpenChange: (o: boolean) => void;
}) {
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      player.onTime((t) => {
        if (timeRef.current) timeRef.current.textContent = fmtTime(t);
      }),
    [player],
  );

  const modes: { value: PlayMode; label: string; hint: string; disabled?: boolean }[] = [
    { value: 'user', label: 'Yours', hint: 'Your take (Y)' },
    { value: 'reference', label: 'Reference', hint: 'The original orator, mapped onto your timeline (R)' },
    { value: 'duet', label: 'Duet', hint: 'You + the reference time-warped onto your timing, in sync (D)' },
    {
      value: 'ghost',
      label: 'Ghost',
      hint: selectedCard ? `Your voice with “${selectedCard.title}” corrected (G)` : 'Select a flaw card to hear it corrected',
      disabled: !selectedCard,
    },
  ];

  return (
    <div className="sticky top-14 z-20 -mx-1 rounded-lg border border-line bg-white/95 px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="md"
          onClick={() => player.toggle()}
          disabled={!audioEnabled}
          hint={audioEnabled ? 'Play / pause (Space)' : audioHint}
          aria-label={ps.playing ? 'Pause' : 'Play'}
          className="w-24"
        >
          {ps.playing ? <IconPause size={14} /> : <IconPlay size={14} />}
          {ps.playing ? 'Pause' : 'Play'}
        </Button>
        <div className="font-mono text-sm text-ink num" aria-label="Playback position">
          <span ref={timeRef}>{fmtTime(player.getTime())}</span>
          <span className="text-ink-faint"> / {fmtTime(analysis.duration_s)}</span>
        </div>
        <Segmented
          label="Playback track"
          value={ps.mode}
          onChange={(m) => player.setMode(m)}
          options={modes.map((m) => ({ ...m, disabled: m.disabled || !audioEnabled, hint: audioEnabled ? m.hint : audioHint }))}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!audioEnabled || !selectedCard}
          hint={!audioEnabled ? audioHint : selectedCard ? `Play “${selectedCard.title}” (±0.8 s) on the ${MODE_LABEL[ps.mode]} track` : 'Select a flaw card first'}
          onClick={() => onPlaySelectedIn(ps.mode)}
        >
          <IconTarget size={14} /> Play flaw
        </Button>
        {ps.mode === 'duet' && audioEnabled && (
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            You
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={ps.duetMix}
              onChange={(e) => player.setDuetMix(Number(e.target.value))}
              className="range w-24"
              aria-label="Duet balance between you and the reference"
            />
            Reference
          </label>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs" aria-live="polite">
          {audioState === 'loading' && (
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <Spinner size={12} /> Loading your take…
            </span>
          )}
          {ps.loading && (
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <Spinner size={12} /> {ps.loading}
            </span>
          )}
          {ps.playing && ps.segment && !ps.loading && (
            <span className="truncate font-medium text-accent">
              ▶ {ps.segment.label}
              {ps.segment.total > 1 && (
                <span className="font-normal text-ink-muted">
                  {' '}
                  ({ps.segment.index + 1}/{ps.segment.total}
                  {ps.segment.loop ? ', looping' : ''})
                </span>
              )}
            </span>
          )}
          {!audioEnabled && audioState !== 'loading' && (
            <span className="truncate text-ink-muted" title={audioHint}>
              {audioHint.startsWith('Audio needs') ? 'Offline sample · audio disabled' : audioHint}
            </span>
          )}
        </div>
        <div className="ml-auto shrink-0">
          <ShortcutsHelp open={helpOpen} onOpenChange={onHelpOpenChange} />
        </div>
      </div>
    </div>
  );
}
