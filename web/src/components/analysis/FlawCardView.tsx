/* One flaw card: what went wrong, where (with bootstrap CIs), why (evidence, statistics, maths),
 * and how to fix it (Ghost Coach counterfactual + phrase drill). */
import { forwardRef, useState } from 'react';
import type { FixOption, FlawCard, GhostResponse } from '../../types';
import { FIX_OPTIONS } from '../../types';
import { FIX_LABEL, cssTexture, defaultFixes, dimColor, dimLabel } from '../../lib/dimensions';
import { fmt, fmtP, fmtPct, fmtSigned, fmtTime, isNum } from '../../lib/format';
import { postGhost, errorMessage } from '../../api';
import type { Player, PlayerState } from '../../lib/player';
import SeverityPips from '../SeverityPips';
import MathBlock from '../MathBlock';
import { Badge, Button, Spinner, Swatch } from '../ui';
import { IconCheck, IconChevronDown, IconChevronRight, IconMic, IconPlay, IconRepeat, IconWand, IconX } from '../icons';
import { cardCost } from './Rubric';

export const REGION_PAD = 0.8;

export interface GhostState {
  status: 'idle' | 'running' | 'done' | 'error';
  result?: GhostResponse;
  error?: string;
  fixes: FixOption[];
}

function ciHalfWidthMs(ci: [number, number] | null): number | null {
  if (!ci || !isNum(ci[0]) || !isNum(ci[1])) return null;
  return ((ci[1] - ci[0]) / 2) * 1000;
}

interface Props {
  card: FlawCard;
  selected: boolean;
  dimmed: boolean;
  speakingS: number;
  duration: number;
  analysisId: string;
  player: Player;
  playerState: PlayerState;
  audioEnabled: boolean;
  audioHint: string;
  ghost: GhostState | undefined;
  onGhost: (id: string, g: GhostState) => void;
  onFocus: () => void;
  onPractise: () => void;
}

const FlawCardView = forwardRef<HTMLElement, Props>(function FlawCardView(
  {
    card,
    selected,
    dimmed,
    speakingS,
    duration,
    analysisId,
    player,
    playerState,
    audioEnabled,
    audioHint,
    ghost,
    onGhost,
    onFocus,
    onPractise,
  },
  ref,
) {
  const [mathOpen, setMathOpen] = useState(false);
  const col = dimColor(card.dimension);
  const ciS = ciHalfWidthMs(card.ci_start);
  const ciE = ciHalfWidthMs(card.ci_end);
  const ciMax = ciS != null || ciE != null ? Math.max(ciS ?? 0, ciE ?? 0) : null;
  const cost = cardCost(card, speakingS);

  return (
    <article
      ref={ref}
      aria-label={`${card.title} at ${fmtTime(card.t_start)}`}
      className={`overflow-hidden rounded-lg border bg-white transition-[border-color,opacity] ${
        selected ? 'border-accent/60 ring-1 ring-accent/30' : 'border-line hover:border-line-strong'
      } ${dimmed ? 'opacity-50' : ''}`}
    >
      <div className="h-1" style={{ backgroundColor: col, backgroundImage: cssTexture(card.dimension, 0.9) }} aria-hidden="true" />
      <button
        type="button"
        onClick={onFocus}
        aria-expanded={selected}
        className="block w-full px-4 pb-3 pt-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Swatch color={col} texture={cssTexture(card.dimension, 0.6)} />
              <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">{dimLabel(card.dimension)}</span>
              <span className="font-mono text-2xs text-ink-faint">{card.id}</span>
            </div>
            <h3 className="mt-1 text-[15px] font-semibold leading-snug text-ink">{card.title}</h3>
          </div>
          <SeverityPips severity={card.severity} dimension={card.dimension} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          <span className="font-mono num text-ink">
            {fmtTime(card.t_start)}–{fmtTime(card.t_end)}
          </span>
          {ciMax != null && (
            <span
              className="font-mono num text-ink-muted"
              title={`95% bootstrap CI — start [${fmt(card.ci_start?.[0])}, ${fmt(card.ci_start?.[1])}] s, end [${fmt(card.ci_end?.[0])}, ${fmt(card.ci_end?.[1])}] s`}
            >
              ± {Math.round(ciMax)} ms CI
            </span>
          )}
          {isNum(card.confidence) && (
            <Badge tone="neutral" title="Share of bootstrap resamples in which this flaw was flagged again">
              {fmtPct(card.confidence)} confidence
            </Badge>
          )}
          {cost > 0 && (
            <Badge tone="red" title={`Costs ${fmt(cost, 2)} points on ${dimLabel(card.dimension)}`}>
              −{fmt(cost, 2)} {dimLabel(card.dimension).toLowerCase()}
            </Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          <span className="text-ink-muted">Words </span>
          <span className="font-medium text-ink">“{card.words}”</span>
        </p>
        <p className="mt-1 text-sm font-medium text-ink">{card.headline}</p>
        {!selected && (
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">
            Show the evidence <IconChevronRight size={12} />
          </span>
        )}
      </button>

      {selected && (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          <p className="text-sm leading-relaxed text-ink-soft">{card.explanation}</p>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            <span className="font-semibold">Fix · </span>
            {card.fix}
          </div>

          {card.evidence.length > 0 && (
            <table className="table-clean text-xs">
              <caption className="sr-only">Evidence: your value against the expected value</caption>
              <thead>
                <tr>
                  <th scope="col">Evidence</th>
                  <th scope="col" className="!text-right">
                    Yours
                  </th>
                  <th scope="col" className="!text-right">
                    Expected
                  </th>
                  <th scope="col" className="!text-right">
                    Δ
                  </th>
                </tr>
              </thead>
              <tbody>
                {card.evidence.map((e, i) => (
                  <tr key={i}>
                    <td className="text-ink-soft">{e.feature}</td>
                    <td className="text-right font-semibold text-accent">
                      {fmt(e.yours)} <span className="font-normal text-ink-muted">{e.unit}</span>
                    </td>
                    <td className="text-right text-amber-800">
                      {fmt(e.expected)} <span className="text-ink-muted">{e.unit}</span>
                    </td>
                    <td className="text-right text-ink">
                      {isNum(e.yours) && isNum(e.expected) ? fmtSigned(e.yours - e.expected) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="font-mono text-2xs text-ink-muted num">
            z = {fmtSigned(card.stats.z)} · p = {fmtP(card.stats.p)} · q<sub>BH</sub> = {fmtP(card.stats.q)} · family {card.stats.family} ·{' '}
            {card.stats.window_words}-word window
          </p>

          {card.math.length > 0 && (
            <div className="rounded-md border border-line">
              <button
                type="button"
                aria-expanded={mathOpen}
                onClick={() => setMathOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
              >
                <span>How the decision was made (the maths)</span>
                <IconChevronDown size={14} className={`transition-transform ${mathOpen ? 'rotate-180' : ''}`} />
              </button>
              {mathOpen && (
                <div className="space-y-0.5 border-t border-line bg-surface-sunken px-3 py-2">
                  {card.math.map((m, i) => (
                    <MathBlock key={i} tex={m} />
                  ))}
                </div>
              )}
            </div>
          )}

          <GhostCoach
            card={card}
            duration={duration}
            analysisId={analysisId}
            player={player}
            playerState={playerState}
            audioEnabled={audioEnabled}
            audioHint={audioHint}
            ghost={ghost}
            onGhost={onGhost}
          />

          <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2">
            <div className="text-xs text-ink-soft">
              <span className="font-semibold text-ink">Practise this phrase</span> — loop it, re-record just these words, and
              see whether the flag clears.
            </div>
            <Button size="sm" variant="secondary" onClick={onPractise} disabled={!audioEnabled} hint={audioEnabled ? undefined : audioHint}>
              <IconMic size={14} /> Drill
            </Button>
          </div>
        </div>
      )}
    </article>
  );
});

export default FlawCardView;

// ----------------------------------------------------------------------------- Ghost Coach
function GhostCoach({
  card,
  duration,
  analysisId,
  player,
  playerState,
  audioEnabled,
  audioHint,
  ghost,
  onGhost,
}: {
  card: FlawCard;
  duration: number;
  analysisId: string;
  player: Player;
  playerState: PlayerState;
  audioEnabled: boolean;
  audioHint: string;
  ghost: GhostState | undefined;
  onGhost: (id: string, g: GhostState) => void;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const state: GhostState = ghost ?? { status: 'idle', fixes: defaultFixes(card.type) };
  const a = Math.max(0, card.t_start - REGION_PAD);
  const b = Math.min(duration, card.t_end + REGION_PAD);

  const playAB = () =>
    player.playSequence([
      { mode: 'user', from: a, to: b, label: 'Yours (flawed)' },
      { mode: 'ghost', from: a, to: b, label: 'Ghost (fixed)', flawId: card.id },
    ]);

  const run = async (fixes: FixOption[]) => {
    onGhost(card.id, { ...state, status: 'running', fixes, error: undefined });
    try {
      const res = await postGhost(analysisId, { flaw_id: card.id, fixes, counterfactual: true });
      player.setGhost(card.id, {
        url: res.audio_url,
        regionOut: Array.isArray(res.region_out) ? res.region_out : null,
        ghostDuration: typeof res.duration_s === 'number' ? res.duration_s : null,
        tStart: card.t_start,
        tEnd: card.t_end,
      });
      onGhost(card.id, { status: 'done', result: res, fixes });
      playAB();
    } catch (e) {
      onGhost(card.id, { status: 'error', error: errorMessage(e), fixes });
    }
  };

  const toggleFix = (f: FixOption) => {
    const next = state.fixes.includes(f) ? state.fixes.filter((x) => x !== f) : [...state.fixes, f];
    onGhost(card.id, { ...state, fixes: next });
  };

  const seg = playerState.segment;
  const playingThis = playerState.playing && seg && (seg.label === 'Yours (flawed)' || seg.label === 'Ghost (fixed)');
  const cf = state.result?.counterfactual;
  const fixesChanged =
    state.result && [...state.fixes].sort().join(',') !== [...(state.result.fixes ?? [])].sort().join(',');

  return (
    <div className="rounded-md border border-indigo-200 bg-accent-soft/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Ghost Coach</p>
          <p className="text-xs text-ink-soft">Your own voice, with only this flaw corrected.</p>
        </div>
        {state.status === 'done' ? (
          <Button size="sm" variant="secondary" onClick={playAB} disabled={!audioEnabled} hint={audioEnabled ? "Play yours, then the ghost" : audioHint}>
            <IconRepeat size={14} /> Replay A/B
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void run(state.fixes)}
            disabled={!audioEnabled || state.status === 'running' || state.fixes.length === 0}
            hint={!audioEnabled ? audioHint : state.fixes.length === 0 ? 'Pick at least one fix' : undefined}
          >
            {state.status === 'running' ? <Spinner size={14} /> : <IconWand size={14} />}
            {state.status === 'running' ? 'Synthesising…' : 'Hear yourself fix it'}
          </Button>
        )}
      </div>

      {state.status === 'running' && (
        <p className="mt-2 text-xs text-ink-soft" aria-live="polite">
          Re-synthesising {fmtTime(card.t_start)}–{fmtTime(card.t_end)} with {state.fixes.map((f) => FIX_LABEL[f]).join(' + ')} corrected, then
          re-testing it… (2–6 s)
        </p>
      )}
      {state.status === 'error' && <p className="mt-2 text-xs text-red-800">{state.error}</p>}

      {state.status === 'done' && state.result && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2" aria-live="polite">
            <button
              type="button"
              onClick={() => player.playRange(a, b, 'user', 'Yours (flawed)')}
              disabled={!audioEnabled}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                playingThis && seg?.label === 'Yours (flawed)' ? 'border-accent bg-white text-accent' : 'border-line bg-white text-ink-soft hover:text-ink'
              }`}
            >
              <IconPlay size={11} /> A · Yours (flawed)
            </button>
            <button
              type="button"
              onClick={() => player.playRange(a, b, 'ghost', 'Ghost (fixed)', card.id)}
              disabled={!audioEnabled}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                playingThis && seg?.label === 'Ghost (fixed)' ? 'border-accent bg-white text-accent' : 'border-line bg-white text-ink-soft hover:text-ink'
              }`}
            >
              <IconPlay size={11} /> B · Ghost (fixed)
            </button>
            {playingThis && <span className="text-2xs text-accent">▶ {seg?.label}</span>}
          </div>
          {cf && (
            <div
              className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                cf.flag_cleared ? 'border-emerald-200 bg-white text-emerald-900' : 'border-amber-200 bg-white text-amber-950'
              }`}
            >
              <span
                className={`mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white ${
                  cf.flag_cleared ? 'bg-emerald-700' : 'bg-amber-700'
                }`}
                aria-hidden="true"
              >
                {cf.flag_cleared ? <IconCheck size={11} strokeWidth={3} /> : <IconX size={11} strokeWidth={3} />}
              </span>
              <span>
                <span className="font-semibold">{cf.flag_cleared ? 'Counterfactual: flag cleared. ' : 'Counterfactual: flag remains. '}</span>
                {cf.sentence}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2">
        <button
          type="button"
          aria-expanded={showOptions}
          onClick={() => setShowOptions((o) => !o)}
          className="inline-flex items-center gap-1 text-2xs font-semibold text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          <IconChevronDown size={12} className={`transition-transform ${showOptions ? 'rotate-180' : ''}`} />
          Which fixes to apply ({state.fixes.map((f) => FIX_LABEL[f]).join(' + ') || 'none'})
        </button>
        {showOptions && (
          <div className="mt-1.5">
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="sr-only">Fixes to apply</legend>
              {FIX_OPTIONS.map((f) => {
                const on = state.fixes.includes(f);
                return (
                  <label
                    key={f}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium ${
                      on ? 'border-indigo-300 bg-white text-accent' : 'border-line bg-white/60 text-ink-muted'
                    }`}
                  >
                    <input type="checkbox" className="accent-accent" checked={on} onChange={() => toggleFix(f)} />
                    {FIX_LABEL[f]}
                  </label>
                );
              })}
            </fieldset>
            <p className="mt-1 text-2xs text-ink-muted">
              Change the fixes and re-run to test which correction is sufficient (a counterfactual explanation).
            </p>
            {(state.status === 'done' || state.status === 'error') && (
              <Button
                size="xs"
                variant={fixesChanged ? 'primary' : 'secondary'}
                className="mt-1.5"
                onClick={() => void run(state.fixes)}
                disabled={!audioEnabled || state.fixes.length === 0}
                hint={!audioEnabled ? audioHint : undefined}
              >
                <IconWand size={12} /> Re-run with these fixes
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
