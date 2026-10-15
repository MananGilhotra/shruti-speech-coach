/* The synchronised timeline: wavesurfer waveform (+ flaw regions and a time axis) on top of stacked
 * canvas feature lanes that share its time axis, zoom and scroll. One playhead spans everything. */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import type { Analysis, FlawCard } from '../../types';
import { cssTexture, cssTextureSize, dimColor, dimLabel, hexToRgba } from '../../lib/dimensions';
import { envelopeFromIntensity } from '../../lib/audio';
import { clamp, fmt, fmtSigned, fmtTime, isNum, niceTicks } from '../../lib/format';
import { fetchBlob, errorMessage } from '../../api';
import type { Player } from '../../lib/player';
import { useLocalStorage } from '../../lib/useAsync';
import { IconFit, IconTarget, IconZoomIn, IconZoomOut } from '../icons';
import { Button, Swatch } from '../ui';
import {
  ACCENT,
  LANE_DEFS,
  computeScales,
  drawLanes,
  evidenceLanes,
  expectedRate,
  layoutLanes,
  wordAt,
  type LaneKey,
} from './lanes';

export interface TimelineHandle {
  zoomTo: (a: number, b: number) => void;
  zoomBy: (factor: number, center?: number) => void;
  fit: () => void;
  getView: () => { t0: number; t1: number };
}

interface Props {
  analysis: Analysis;
  player: Player;
  /** URL of the user's take; null renders the loudness envelope instead (offline / unavailable). */
  audioUrl: string | null;
  cards: FlawCard[];
  selectedId: string | null;
  highlightDim: string | null;
  onSelectCard: (id: string) => void;
  onAudioState: (state: 'loading' | 'ready' | 'unavailable', message?: string) => void;
}

const WAVE_H = 92;
const AXIS_H = 20;
const MIN_WINDOW = 1.0;
const GUTTER = 116;

const DEFAULT_LANES: LaneKey[] = ['words', 'pitch', 'loudness', 'rate', 'pauses'];

const LABEL_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];

/** Tick/label spacing for the time axis so labels stay ~90 px apart at any zoom. */
function axisIntervals(pxPerSec: number) {
  const primary = LABEL_STEPS.find((s) => s * pxPerSec >= 90) ?? 60;
  const tick = primary <= 0.2 ? primary / 2 : primary / 5;
  return { primary, secondary: primary / 2, tick };
}

function formatAxis(s: number, step: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return `${m}:${rest.toFixed(step < 1 ? 1 : 0).padStart(step < 1 ? 4 : 2, '0')}`;
  }
  return step < 1 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

function regionLabel(c: FlawCard): HTMLElement {
  const el = document.createElement('div');
  el.textContent = c.title;
  Object.assign(el.style, {
    font: '600 10px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    color: '#0f172a',
    background: 'rgba(255,255,255,0.94)',
    borderLeft: `3px solid ${dimColor(c.dimension)}`,
    padding: '1px 5px',
    margin: '3px 0 0 3px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    display: 'inline-block',
    pointerEvents: 'none',
    boxShadow: '0 0 0 1px rgba(15,23,42,0.10)',
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

function styleRegion(r: Region, c: FlawCard, selected: boolean, dimmed: boolean) {
  const el = r.element;
  if (!el) return;
  const col = dimColor(c.dimension);
  const k = dimmed ? 0.35 : 1;
  el.style.backgroundColor = hexToRgba(col, (selected ? 0.16 : 0.1) * k);
  el.style.backgroundImage = cssTexture(c.dimension, (selected ? 0.38 : 0.28) * k);
  el.style.backgroundSize = cssTextureSize(c.dimension);
  el.style.borderLeft = `${selected ? 2 : 1}px solid ${hexToRgba(col, 0.9 * k)}`;
  el.style.borderRight = `${selected ? 2 : 1}px solid ${hexToRgba(col, 0.9 * k)}`;
  el.style.cursor = 'pointer';
  el.title = `${c.title} — ${fmtTime(c.t_start)}–${fmtTime(c.t_end)}`;
}

const Timeline = forwardRef<TimelineHandle, Props>(function Timeline(
  { analysis, player, audioUrl, cards, selectedId, highlightDim, onSelectCard, onAudioState },
  ref,
) {
  const duration = analysis.duration_s;
  const wsBox = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const axisRef = useRef<TimelinePlugin | null>(null);
  const axisStep = useRef(10);
  const regionMap = useRef(new Map<string, Region>());
  const rafRef = useRef(0);
  const [wsGen, setWsGen] = useState(0);
  const [storedLanes, setLanes] = useLocalStorage<LaneKey[]>('shruti.lanes.v1', DEFAULT_LANES);
  const lanes = Array.isArray(storedLanes) ? storedLanes : DEFAULT_LANES;
  const [view, setView] = useState({ t0: 0, t1: duration });
  const [hover, setHover] = useState<{ t: number; x: number; y: number } | null>(null);
  const [follow, setFollow] = useState(true);

  const scales = useMemo(() => computeScales(analysis), [analysis]);
  const selectedCard = useMemo(() => cards.find((c) => c.id === selectedId) ?? null, [cards, selectedId]);
  const evidence = useMemo(() => evidenceLanes(selectedCard).filter((k) => k !== 'clarity' || (analysis.lanes.cpp?.length ?? 0) > 0), [selectedCard, analysis]);
  // the evidence lane of the selected flaw is always shown, even if the user hid it
  const hasTruth = (analysis.demo?.labels?.length ?? 0) > 0;
  const [hideTruth, setHideTruth] = useState(false);
  const shownLanes = useMemo(
    () =>
      LANE_DEFS.map((d) => d.key).filter((k) => (k === 'truth' ? hasTruth && !hideTruth : lanes.includes(k) || evidence.includes(k))),
    [lanes, evidence, hasTruth, hideTruth],
  );
  const layout = useMemo(() => layoutLanes(shownLanes), [shownLanes]);
  const envelope = useMemo(() => envelopeFromIntensity(analysis.lanes.int_rel), [analysis]);
  const flagged = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cards) for (let i = c.word_span[0]; i <= c.word_span[1]; i++) m.set(i, c.dimension);
    return m;
  }, [cards]);

  const hoverWord = useMemo(() => {
    if (!hover) return -1;
    const i = wordAt(analysis.words, hover.t);
    return i >= 0 && hover.t <= analysis.words[i].end ? i : -1;
  }, [hover, analysis.words]);

  // ----------------------------------------------------------------------- view helpers
  const wsDuration = useCallback(() => wsRef.current?.getDuration() || duration, [duration]);

  const getView = useCallback(() => {
    const ws = wsRef.current;
    const D = wsDuration();
    if (!ws) return { t0: 0, t1: D };
    const W = ws.getWidth();
    const total = ws.getWrapper().clientWidth;
    if (!W || !total) return { t0: 0, t1: D };
    const pps = total / D;
    const t0 = Math.max(0, ws.getScroll() / pps);
    return { t0, t1: Math.min(D, t0 + W / pps) };
  }, [wsDuration]);

  const positionPlayhead = useCallback(
    (t: number) => {
      const el = playheadRef.current;
      const plot = plotRef.current;
      if (!el || !plot) return;
      const v = getView();
      const W = plot.clientWidth;
      if (t < v.t0 || t > v.t1) {
        el.style.opacity = '0';
        return;
      }
      el.style.opacity = '1';
      el.style.transform = `translateX(${Math.round(((t - v.t0) / (v.t1 - v.t0)) * W)}px)`;
    },
    [getView],
  );

  // latest draw inputs live in a ref so the rAF callback is always current
  const drawInputs = useRef({ selectedId, highlightDim, hoverT: null as number | null, hoverWord, layout, cards, flagged, evidence });
  drawInputs.current = { selectedId, highlightDim, hoverT: hover?.t ?? null, hoverWord, layout, cards, flagged, evidence };

  const draw = useCallback(() => {
    rafRef.current = 0;
    const cv = canvasRef.current;
    const plot = plotRef.current;
    if (!cv || !plot) return;
    const d = drawInputs.current;
    const W = plot.clientWidth;
    const H = d.layout.height;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const v = getView();
    drawLanes(ctx, {
      analysis,
      scales,
      boxes: d.layout.boxes,
      width: W,
      height: H,
      dpr,
      t0: v.t0,
      t1: v.t1,
      cards: d.cards,
      selectedId: d.selectedId,
      highlightDim: d.highlightDim,
      hoverT: d.hoverT,
      hoverWord: d.hoverWord,
      flagged: d.flagged,
      evidence: d.evidence,
    });
    positionPlayhead(player.getTime());
    setView((old) => (Math.abs(old.t0 - v.t0) > 1e-3 || Math.abs(old.t1 - v.t1) > 1e-3 ? v : old));
  }, [analysis, scales, getView, positionPlayhead, player]);

  const drawRef = useRef(draw);
  drawRef.current = draw;
  const schedule = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(() => drawRef.current());
  }, []);

  useEffect(() => schedule(), [schedule, selectedId, highlightDim, hover, layout, cards, draw]);

  // ----------------------------------------------------------------------- zoom / scroll
  const setAxisFor = useCallback((pxPerSec: number) => {
    const axis = axisRef.current as unknown as { options?: Record<string, unknown> } | null;
    if (!axis?.options) return;
    const iv = axisIntervals(pxPerSec);
    axisStep.current = iv.primary;
    axis.options.timeInterval = iv.tick;
    axis.options.primaryLabelInterval = iv.primary;
    axis.options.secondaryLabelInterval = iv.secondary;
  }, []);

  const zoomTo = useCallback(
    (a: number, b: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const D = wsDuration();
      let span = clamp(b - a, MIN_WINDOW, D);
      if (span >= D - 1e-3) {
        setAxisFor((ws.getWidth() || 800) / D);
        ws.zoom(0);
        ws.setScroll(0);
        schedule();
        return;
      }
      const W = ws.getWidth() || plotRef.current?.clientWidth || 800;
      const start = clamp(a, 0, D - span);
      span = Math.min(span, D - start);
      const pps = W / span;
      setAxisFor(pps);
      ws.zoom(pps);
      ws.setScroll(start * (ws.getWrapper().clientWidth / D));
      schedule();
    },
    [wsDuration, schedule, setAxisFor],
  );

  const zoomBy = useCallback(
    (factor: number, center?: number) => {
      const v = getView();
      const span = v.t1 - v.t0;
      const t = player.getTime();
      const c = center ?? (t >= v.t0 && t <= v.t1 ? t : (v.t0 + v.t1) / 2);
      const next = clamp(span / factor, MIN_WINDOW, wsDuration());
      const a = c - (c - v.t0) * (next / span);
      zoomTo(a, a + next);
    },
    [getView, player, wsDuration, zoomTo],
  );

  const fit = useCallback(() => zoomTo(0, wsDuration()), [zoomTo, wsDuration]);

  const panTo = useCallback(
    (t0: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const D = wsDuration();
      ws.setScroll(Math.max(0, t0) * (ws.getWrapper().clientWidth / D));
      schedule();
    },
    [wsDuration, schedule],
  );

  useImperativeHandle(ref, () => ({ zoomTo, zoomBy, fit, getView }), [zoomTo, zoomBy, fit, getView]);

  // ----------------------------------------------------------------------- wavesurfer lifecycle
  const onSelectRef = useRef(onSelectCard);
  onSelectRef.current = onSelectCard;

  useEffect(() => {
    if (!wsBox.current) return;
    const regions = RegionsPlugin.create();
    const W0 = wsBox.current.clientWidth || 800;
    const iv = axisIntervals(W0 / duration);
    axisStep.current = iv.primary;
    const axis = TimelinePlugin.create({
      height: AXIS_H,
      style: { fontSize: '10px', color: '#64748b' },
      timeInterval: iv.tick,
      primaryLabelInterval: iv.primary,
      secondaryLabelInterval: iv.secondary,
      secondaryLabelOpacity: 0.55,
      formatTimeCallback: (sec: number) => formatAxis(sec, axisStep.current),
    });
    axisRef.current = axis;
    const ws = WaveSurfer.create({
      container: wsBox.current,
      height: WAVE_H,
      waveColor: '#818cf8',
      progressColor: '#818cf8',
      cursorWidth: 0,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      hideScrollbar: true,
      autoScroll: false,
      autoCenter: false,
      dragToSeek: false,
      peaks: [envelope],
      duration,
      plugins: [regions, axis],
    });
    wsRef.current = ws;
    regionsRef.current = regions;
    player.attachWaveSurfer(ws);
    const subs = [
      ws.on('scroll', schedule),
      ws.on('zoom', schedule),
      ws.on('redrawcomplete', schedule),
      ws.on('resize', schedule),
      ws.on('ready', () => {
        schedule();
        setWsGen((g) => g + 1);
      }),
      ws.on('interaction', (t: number) => player.seek(t)),
      regions.on('region-clicked', (r: Region) => onSelectRef.current(r.id)),
    ];
    setWsGen((g) => g + 1);
    return () => {
      subs.forEach((u) => u());
      player.attachWaveSurfer(null);
      regionMap.current.clear();
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
      axisRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.analysis_id, player]);

  // load the real audio (falls back to the loudness envelope when unavailable)
  const onAudioStateRef = useRef(onAudioState);
  onAudioStateRef.current = onAudioState;
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (!audioUrl) {
      onAudioStateRef.current('unavailable');
      return;
    }
    let cancelled = false;
    onAudioStateRef.current('loading');
    fetchBlob(audioUrl)
      .then((blob) => (cancelled ? undefined : ws.loadBlob(blob)))
      .then(() => {
        if (!cancelled) onAudioStateRef.current('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        onAudioStateRef.current('unavailable', errorMessage(e));
        void ws.load('', [envelope], duration).catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [audioUrl, analysis.analysis_id, player, envelope, duration]);

  // (re)create flaw regions
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    regions.clearRegions();
    regionMap.current.clear();
    for (const c of cards) {
      const r = regions.addRegion({
        id: c.id,
        start: c.t_start,
        end: Math.max(c.t_end, c.t_start + 0.02),
        drag: false,
        resize: false,
        color: hexToRgba(dimColor(c.dimension), 0.11),
        content: regionLabel(c),
      });
      regionMap.current.set(c.id, r);
    }
  }, [cards, wsGen]);

  // region emphasis follows selection / dimension highlight
  useEffect(() => {
    for (const c of cards) {
      const r = regionMap.current.get(c.id);
      if (r) styleRegion(r, c, c.id === selectedId, highlightDim != null && highlightDim !== c.dimension);
    }
  }, [cards, selectedId, highlightDim, wsGen]);

  // ----------------------------------------------------------------------- playhead + follow
  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    return player.onTime((t) => {
      positionPlayhead(t);
      if (!followRef.current || !player.state.playing) return;
      const v = getView();
      const span = v.t1 - v.t0;
      if (span >= wsDuration() - 1e-3) return;
      if (t > v.t1 - span * 0.04 || t < v.t0) panTo(Math.max(0, t - span * 0.1));
    });
  }, [player, positionPlayhead, getView, panTo, wsDuration]);

  // ----------------------------------------------------------------------- resize, wheel, pointer
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(plot);
    const onWheel = (e: WheelEvent) => {
      const ws = wsRef.current;
      if (!ws) return;
      const rect = plot.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const v = getView();
        const t = v.t0 + ((e.clientX - rect.left) / rect.width) * (v.t1 - v.t0);
        zoomBy(Math.exp(-e.deltaY * 0.01), t);
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        ws.setScroll(ws.getScroll() + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
        schedule();
      }
    };
    plot.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      ro.disconnect();
      plot.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [schedule, getView, zoomBy]);

  const hoverRaf = useRef(0);
  const onMove = (e: React.MouseEvent) => {
    const plot = plotRef.current;
    if (!plot) return;
    const rect = plot.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => {
      const v = getView();
      setHover({ t: v.t0 + (px / rect.width) * (v.t1 - v.t0), x: px, y: py });
    });
  };
  const onLeave = () => {
    cancelAnimationFrame(hoverRaf.current);
    setHover(null);
  };
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const v = getView();
    const t = v.t0 + ((e.clientX - rect.left) / rect.width) * (v.t1 - v.t0);
    player.seek(t);
    const hit = cards.find((c) => t >= c.t_start && t <= c.t_end);
    if (hit) onSelectCard(hit.id);
  };

  const toggleLane = (k: LaneKey) =>
    setLanes((stored) => {
      const cur = Array.isArray(stored) ? stored : DEFAULT_LANES;
      return cur.includes(k) ? cur.filter((x) => x !== k) : LANE_DEFS.map((d) => d.key).filter((x) => x === k || cur.includes(x));
    });

  const presentDims = useMemo(() => Array.from(new Set(cards.map((c) => c.dimension))), [cards]);
  const span = view.t1 - view.t0;
  const zoomFactor = wsDuration() / Math.max(span, 1e-6);

  return (
    <div className="rounded-lg border border-line bg-white">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <Button size="xs" variant="ghost" onClick={() => zoomBy(1 / 1.6)} hint="Zoom out (−)" aria-label="Zoom out">
            <IconZoomOut size={15} />
          </Button>
          <Button size="xs" variant="ghost" onClick={() => zoomBy(1.6)} hint="Zoom in (+)" aria-label="Zoom in">
            <IconZoomIn size={15} />
          </Button>
          <Button size="xs" variant="ghost" onClick={fit} hint="Show the whole take (0)" aria-label="Fit whole take">
            <IconFit size={15} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!selectedId}
            onClick={() => {
              const c = cards.find((x) => x.id === selectedId);
              if (c) zoomTo(c.t_start - 1, c.t_end + 1);
            }}
            hint={selectedId ? 'Zoom to the selected flaw' : 'Select a flaw card first'}
            aria-label="Zoom to selected flaw"
          >
            <IconTarget size={15} />
          </Button>
          <span className="ml-1 font-mono text-2xs text-ink-muted num" aria-live="polite">
            {fmtTime(view.t0, 1)}–{fmtTime(view.t1, 1)} · ×{zoomFactor.toFixed(1)}
          </span>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-accent" />
          Follow playhead
        </label>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Visible lanes">
          <span className="mr-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Lanes</span>
          {LANE_DEFS.filter((d) => d.key !== 'truth' || hasTruth).map((d) => {
            const on = d.key === 'truth' ? !hideTruth : lanes.includes(d.key);
            return (
              <button
                key={d.key}
                type="button"
                aria-pressed={on}
                onClick={() => (d.key === 'truth' ? setHideTruth((h) => !h) : toggleLane(d.key))}
                title={d.description}
                className={`rounded-md border px-1.5 py-0.5 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                  on ? 'border-indigo-200 bg-accent-soft text-accent' : 'border-line bg-white text-ink-muted hover:text-ink'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-2xs text-ink-soft">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4 rounded" style={{ background: ACCENT }} aria-hidden="true" /> Yours
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm border-y-2 border-amber-700/80 bg-amber-600/20" aria-hidden="true" />
            Reference mean ± 1 SD
          </span>
          {hasTruth && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-slate-600" aria-hidden="true" /> Injected (truth)
            </span>
          )}
          {presentDims.map((d) => (
            <span key={d} className="inline-flex items-center gap-1">
              <Swatch color={dimColor(d)} texture={cssTexture(d, 0.6)} /> {dimLabel(d)}
            </span>
          ))}
        </div>
      </div>

      {/* plot */}
      <div className="grid" style={{ gridTemplateColumns: `${GUTTER}px minmax(0, 1fr)` }}>
        <div className="border-r border-line bg-surface-sunken" aria-hidden="true">
          <div className="flex flex-col justify-center px-3" style={{ height: WAVE_H }}>
            <span className="text-xs font-semibold text-ink">Your take</span>
            <span className="text-2xs text-ink-muted">waveform · flaws</span>
          </div>
          <div className="flex items-center px-3 text-2xs text-ink-muted" style={{ height: AXIS_H }}>
            time
          </div>
          {layout.boxes.map((b) => {
            const def = LANE_DEFS.find((d) => d.key === b.key)!;
            const range = b.key === 'words' || b.key === 'truth' ? null : scales[b.key];
            return (
              <div
                key={b.key}
                className="relative border-t border-line"
                style={{
                  height: b.h,
                  boxShadow: evidence.includes(b.key) && selectedCard ? `inset 3px 0 0 ${dimColor(selectedCard.dimension)}` : undefined,
                }}
                title={def.description}
              >
                <div className="absolute left-3 top-1.5 text-xs font-semibold text-ink">
                  {def.label}
                  {def.unit && <span className="ml-1 font-normal text-ink-muted">{def.unit}</span>}
                  {b.h < 40 && evidence.includes(b.key) && selectedCard && <EvidenceTag inline />}
                </div>
                {b.h >= 40 && evidence.includes(b.key) && selectedCard && (
                  <div className="absolute left-3 top-[1.35rem]">
                    <EvidenceTag />
                  </div>
                )}
                {range &&
                  niceTicks(range[0], range[1], b.h > 70 ? 3 : 2).map((v) => {
                    const top = 5 + (1 - (v - range[0]) / (range[1] - range[0] || 1)) * (b.h - 10);
                    if (top < 16 || top > b.h - 4) return null;
                    return (
                      <span
                        key={v}
                        className="absolute right-1.5 -translate-y-1/2 font-mono text-[9px] leading-none text-ink-faint"
                        style={{ top }}
                      >
                        {v > 0 && b.key !== 'rate' && b.key !== 'pauses' && b.key !== 'clarity' ? `+${v}` : v}
                      </span>
                    );
                  })}
              </div>
            );
          })}
        </div>

        <div ref={plotRef} className="relative min-w-0" onMouseMove={onMove} onMouseLeave={onLeave}>
          <div ref={wsBox} style={{ minHeight: WAVE_H + AXIS_H }} />
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            className="block cursor-crosshair"
            style={{ height: layout.height }}
            aria-label="Feature lanes: pitch, loudness, speech rate and pauses against the reference expectation"
            role="img"
          />
          <div
            ref={playheadRef}
            className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-0"
            style={{ opacity: 0 }}
            aria-hidden="true"
          >
            <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-accent" />
            <div className="absolute bottom-0 left-[-1px] top-0 w-[2px] bg-accent" />
          </div>
          {hover && <HoverReadout analysis={analysis} t={hover.t} x={hover.x} y={hover.y} plot={plotRef.current} />}
        </div>
      </div>

      <Overview
        analysis={analysis}
        envelope={envelope}
        cards={cards}
        view={view}
        duration={wsDuration()}
        onPan={(t0) => panTo(t0)}
        selectedId={selectedId}
      />
    </div>
  );
});

export default Timeline;

function EvidenceTag({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={`rounded bg-slate-900 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-white ${inline ? 'ml-1.5 align-middle' : ''}`}
      title="The selected flaw was detected from this feature"
    >
      evidence
    </span>
  );
}

// ----------------------------------------------------------------------------- hover readout
function HoverReadout({ analysis, t, x, y, plot }: { analysis: Analysis; t: number; x: number; y: number; plot: HTMLDivElement | null }) {
  const L = analysis.lanes;
  const step = L.t.length > 1 ? L.t[1] - L.t[0] : 0.02;
  const fi = clamp(Math.round((t - (L.t[0] ?? 0)) / step), 0, Math.max(0, L.t.length - 1));
  const f0 = L.f0_st[fi];
  const loud = L.int_rel[fi];
  const wi = wordAt(analysis.words, t);
  const w = wi >= 0 ? analysis.words[wi] : null;
  const inWord = w != null && t <= w.end;
  const W = plot?.clientWidth ?? 800;
  const left = x > W - 270 ? x - 262 : x + 14;
  const top = Math.max(4, Math.min(y - 20, (plot?.clientHeight ?? 400) - 170));
  const row = (label: string, yours: string, exp: string | null) => (
    <tr>
      <td className="pr-3 text-ink-muted">{label}</td>
      <td className="pr-3 text-right font-medium text-ink">{yours}</td>
      <td className="text-right text-amber-800">{exp ?? ''}</td>
    </tr>
  );
  return (
    <div
      className="pointer-events-none absolute z-20 w-[248px] rounded-lg border border-line bg-white/95 px-3 py-2 text-2xs shadow-[0_4px_14px_rgba(15,23,42,0.10)]"
      style={{ left, top }}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-ink">{fmtTime(t)}</span>
        <span className="truncate text-xs font-semibold text-ink">
          {w ? (inWord ? `“${w.word}”` : `pause after “${w.word}”`) : 'before speech'}
        </span>
      </div>
      <table className="w-full num">
        <thead>
          <tr>
            <th />
            <th className="pr-3 text-right font-medium text-ink-muted">yours</th>
            <th className="text-right font-medium text-ink-muted">expected</th>
          </tr>
        </thead>
        <tbody>
          {row(
            'Pitch',
            isNum(f0) ? `${fmtSigned(f0, 1)} st` : 'unvoiced',
            inWord && w?.ref?.f0_med_st ? `${fmtSigned(w.ref.f0_med_st.m, 1)} ± ${fmt(w.ref.f0_med_st.sd, 1)}` : null,
          )}
          {row(
            'Loudness',
            isNum(loud) ? `${fmtSigned(loud, 1)} dB` : '—',
            inWord && w?.ref?.int_med_db ? `${fmtSigned(w.ref.int_med_db.m, 1)} ± ${fmt(w.ref.int_med_db.sd, 1)}` : null,
          )}
          {w &&
            row(
              'Rate',
              isNum(w.rate) ? `${fmt(w.rate, 1)} syl/s` : '—',
              expectedRate(w) != null ? `${fmt(expectedRate(w), 1)}` : null,
            )}
          {w &&
            row(
              'Pause after',
              isNum(w.pause_after) ? `${fmt(w.pause_after, 2)} s` : '—',
              w.ref && isNum(w.ref.pause_after) ? `${fmt(w.ref.pause_after, 2)} s` : null,
            )}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------------------------------- overview / minimap
function Overview({
  analysis,
  envelope,
  cards,
  view,
  duration,
  onPan,
  selectedId,
}: {
  analysis: Analysis;
  envelope: number[];
  cards: FlawCard[];
  view: { t0: number; t1: number };
  duration: number;
  onPan: (t0: number) => void;
  selectedId: string | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ startX: number; startT0: number } | null>(null);
  const [w, setW] = useState(0);
  const H = 30;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => setW(box.clientWidth));
    ro.observe(box);
    setW(box.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || !w) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${H}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);
    const x = (t: number) => (t / duration) * w;
    for (const c of cards) {
      ctx.fillStyle = hexToRgba(dimColor(c.dimension), c.id === selectedId ? 0.55 : 0.32);
      ctx.fillRect(x(c.t_start), 0, Math.max(2, x(c.t_end) - x(c.t_start)), H);
    }
    // envelope (pairs of +a/-a values per 20 ms frame)
    const n = envelope.length / 2;
    const step = analysis.lanes.t.length > 1 ? analysis.lanes.t[1] - analysis.lanes.t[0] : 0.02;
    ctx.fillStyle = '#94a3b8';
    const cols = Math.max(1, Math.floor(w / 2));
    for (let c = 0; c < cols; c++) {
      const ta = (c / cols) * duration;
      const tb = ((c + 1) / cols) * duration;
      let m = 0;
      for (let i = Math.floor(ta / step); i < Math.min(n, Math.ceil(tb / step)); i++) m = Math.max(m, envelope[2 * i] ?? 0);
      const hh = Math.max(1, m * (H - 8));
      ctx.fillRect(c * 2, (H - hh) / 2, 1.2, hh);
    }
  }, [w, analysis, envelope, cards, duration, selectedId]);

  const left = (view.t0 / duration) * w;
  const width = Math.max(6, ((view.t1 - view.t0) / duration) * w);
  const full = view.t1 - view.t0 >= duration - 1e-3;

  const onPointerDown = (e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    const span = view.t1 - view.t0;
    const insideWindow = t >= view.t0 && t <= view.t1;
    const t0 = insideWindow ? view.t0 : clamp(t - span / 2, 0, duration - span);
    if (!insideWindow) onPan(t0);
    drag.current = { startX: e.clientX, startT0: t0 };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !w) return;
    const dt = ((e.clientX - drag.current.startX) / w) * duration;
    const span = view.t1 - view.t0;
    onPan(clamp(drag.current.startT0 + dt, 0, duration - span));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="grid border-t border-line" style={{ gridTemplateColumns: `${GUTTER}px minmax(0, 1fr)` }}>
      <div className="flex items-center border-r border-line bg-surface-sunken px-3 text-2xs text-ink-muted">Overview</div>
      <div
        ref={boxRef}
        className={`relative my-1.5 mx-0 ${full ? 'cursor-default' : 'cursor-grab'} select-none`}
        style={{ height: H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-label="Visible part of the take"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(view.t0)}
        tabIndex={-1}
      >
        <canvas ref={cvRef} className="absolute inset-0" />
        {!full && (
          <div
            className="absolute bottom-0 top-0 rounded-sm border-2 border-accent bg-accent/10"
            style={{ left, width }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}
