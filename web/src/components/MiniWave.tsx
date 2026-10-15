/* Compact wavesurfer player with optional (editable) regions and point markers.
 * Used by the Benchmark Explorer, the Studio reviewer and the adjudicator study. */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { fetchBlob, errorMessage } from '../api';
import { fmtTime } from '../lib/format';
import { cssTexture, hexToRgba } from '../lib/dimensions';
import { IconPause, IconPlay } from './icons';
import { Button, Spinner } from './ui';

export interface MiniRegion {
  id: string;
  start: number;
  end: number;
  color: string;
  label?: string;
  dimension?: string;
  editable?: boolean;
}

export interface MiniMarker {
  id: string;
  t: number;
  color: string;
  label?: string;
}

export interface MiniWaveHandle {
  play: (start?: number, end?: number) => void;
  pause: () => void;
  getTime: () => number;
}

interface Props {
  url: string | null;
  height?: number;
  regions?: MiniRegion[];
  markers?: MiniMarker[];
  onClickTime?: (t: number) => void;
  onRegionChange?: (id: string, start: number, end: number) => void;
  disabledReason?: string;
  onReady?: (duration: number) => void;
}

const MiniWave = forwardRef<MiniWaveHandle, Props>(function MiniWave(
  { url, height = 80, regions = [], markers = [], onClickTime, onRegionChange, disabledReason, onReady },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regRef = useRef<RegionsPlugin | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const cbs = useRef({ onClickTime, onRegionChange, onReady });
  cbs.current = { onClickTime, onRegionChange, onReady };

  useImperativeHandle(
    ref,
    () => ({
      play: (start?: number, end?: number) => {
        const ws = wsRef.current;
        if (!ws || state !== 'ready') return;
        void ws.play(start, end);
      },
      pause: () => wsRef.current?.pause(),
      getTime: () => wsRef.current?.getCurrentTime() ?? 0,
    }),
    [state],
  );

  useEffect(() => {
    if (!box.current || !url) {
      setState('idle');
      return;
    }
    let cancelled = false;
    const regionsPlugin = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: box.current,
      height,
      waveColor: '#a5b4fc',
      progressColor: '#3730a3',
      cursorColor: '#3730a3',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      dragToSeek: true,
      plugins: [
        regionsPlugin,
        TimelinePlugin.create({ height: 16, style: { fontSize: '9px', color: '#64748b' } }),
      ],
    });
    wsRef.current = ws;
    regRef.current = regionsPlugin;
    setState('loading');
    setError(null);
    setPlaying(false);
    setTime(0);
    const subs = [
      ws.on('play', () => setPlaying(true)),
      ws.on('pause', () => setPlaying(false)),
      ws.on('finish', () => setPlaying(false)),
      ws.on('timeupdate', (t: number) => setTime(t)),
      ws.on('ready', (d: number) => {
        setDuration(d);
        setState('ready');
        cbs.current.onReady?.(d);
      }),
      ws.on('interaction', (t: number) => cbs.current.onClickTime?.(t)),
      regionsPlugin.on('region-updated', (r: Region) => cbs.current.onRegionChange?.(r.id, r.start, r.end)),
    ];
    fetchBlob(url)
      .then((b) => (cancelled ? undefined : ws.loadBlob(b)))
      .catch((e: unknown) => {
        if (cancelled) return;
        setState('error');
        setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
      subs.forEach((u) => u());
      ws.destroy();
      wsRef.current = null;
      regRef.current = null;
    };
  }, [url, height]);

  // regions + markers
  useEffect(() => {
    const rp = regRef.current;
    if (!rp || state !== 'ready') return;
    rp.clearRegions();
    for (const r of regions) {
      const reg = rp.addRegion({
        id: r.id,
        start: r.start,
        end: Math.max(r.end, r.start + 0.02),
        color: hexToRgba(r.color, r.editable ? 0.22 : 0.16),
        drag: !!r.editable,
        resize: !!r.editable,
        content: r.label ? label(r.label, r.color) : undefined,
      });
      if (reg.element) {
        if (r.dimension) reg.element.style.backgroundImage = cssTexture(r.dimension, 0.35);
        reg.element.style.borderLeft = `1px solid ${r.color}`;
        reg.element.style.borderRight = `1px solid ${r.color}`;
      }
    }
    for (const m of markers) {
      rp.addRegion({ id: m.id, start: m.t, color: m.color, drag: false, resize: false, content: m.label ? label(m.label, m.color) : undefined });
    }
  }, [regions, markers, state]);

  const disabled = state !== 'ready' || !!disabledReason;
  return (
    <div className="rounded-lg border border-line bg-white">
      <div className="relative px-2 pt-2">
        {!url && (
          <div className="flex items-center justify-center text-xs text-ink-muted" style={{ height: height + 16 }}>
            {disabledReason ?? 'No audio'}
          </div>
        )}
        <div ref={box} className={state === 'error' ? 'hidden' : ''} />
        {state === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white/70 text-xs text-ink-muted">
            <Spinner size={14} /> Loading audio…
          </div>
        )}
        {state === 'error' && (
          <div className="flex items-center justify-center px-3 text-center text-xs text-red-800" style={{ height: height + 16 }}>
            Audio unavailable: {error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-2 py-1.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void wsRef.current?.playPause()}
          disabled={disabled}
          hint={disabledReason}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <IconPause size={13} /> : <IconPlay size={13} />}
          {playing ? 'Pause' : 'Play'}
        </Button>
        <span className="font-mono text-2xs text-ink-muted num">
          {fmtTime(time)} / {fmtTime(duration)}
        </span>
      </div>
    </div>
  );
});

function label(text: string, color: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    font: '600 10px ui-sans-serif, system-ui, -apple-system, sans-serif',
    color: '#0f172a',
    background: 'rgba(255,255,255,0.92)',
    borderLeft: `3px solid ${color}`,
    padding: '1px 4px',
    margin: '2px 0 0 2px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    display: 'inline-block',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

export default MiniWave;
