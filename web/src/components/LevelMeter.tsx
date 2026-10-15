import { useEffect, useRef, useState } from 'react';
import type { LevelReading } from '../lib/useRecorder';

export type LevelVerdict = 'none' | 'quiet' | 'good' | 'loud' | 'clipping';

/** Live input meter driven by requestAnimationFrame (no React re-render per frame).
 *  Reports a verdict (too quiet / good / clipping) from the recent loudness history. */
export default function LevelMeter({
  getLevel,
  active,
  onVerdict,
  compact = false,
}: {
  getLevel: () => LevelReading | null;
  active: boolean;
  onVerdict?: (v: LevelVerdict) => void;
  compact?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const [verdict, setVerdict] = useState<LevelVerdict>('none');
  const hist = useRef<{ t: number; db: number; peak: number }[]>([]);
  const onVerdictRef = useRef(onVerdict);
  onVerdictRef.current = onVerdict;

  useEffect(() => {
    if (!active) {
      if (barRef.current) barRef.current.style.width = '0%';
      return;
    }
    let raf = 0;
    let peakHold = 0;
    let lastVerdictAt = 0;
    let lastVerdict: LevelVerdict = 'none';
    const loop = () => {
      const r = getLevel();
      const now = performance.now();
      if (r) {
        // map -60..0 dBFS to 0..100 %
        const pct = Math.max(0, Math.min(100, ((r.rmsDb + 60) / 60) * 100));
        if (barRef.current) {
          barRef.current.style.width = `${pct}%`;
          barRef.current.style.backgroundColor = r.peak >= 0.99 ? '#b91c1c' : pct > 85 ? '#b45309' : '#3730a3';
        }
        peakHold = Math.max(peakHold * 0.97, Math.min(1, r.peak));
        if (peakRef.current) peakRef.current.style.left = `${Math.min(99, peakHold * 100)}%`;
        hist.current.push({ t: now, db: r.rmsDb, peak: r.peak });
        while (hist.current.length && now - hist.current[0].t > 2000) hist.current.shift();
        if (now - lastVerdictAt > 400) {
          lastVerdictAt = now;
          const maxDb = Math.max(...hist.current.map((h) => h.db));
          const clipped = hist.current.some((h) => h.peak >= 0.99);
          const v: LevelVerdict = clipped ? 'clipping' : maxDb < -42 ? 'quiet' : maxDb > -6 ? 'loud' : 'good';
          if (v !== lastVerdict) {
            lastVerdict = v;
            setVerdict(v);
            onVerdictRef.current?.(v);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, getLevel]);

  const text: Record<LevelVerdict, string> = {
    none: 'Microphone idle',
    quiet: 'Too quiet — move closer or speak up',
    good: 'Good level',
    loud: 'Very loud — move back a little',
    clipping: 'Clipping — move back or lower the input gain',
  };
  const tone =
    verdict === 'good' ? 'text-emerald-800' : verdict === 'none' ? 'text-ink-muted' : verdict === 'clipping' ? 'text-red-700' : 'text-amber-800';

  return (
    <div className={compact ? 'w-40' : 'w-full'}>
      <div
        className="relative h-2.5 overflow-hidden rounded-full bg-slate-200"
        role="meter"
        aria-label="Microphone input level"
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div ref={barRef} className="h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: '0%' }} />
        <div ref={peakRef} className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: '0%' }} aria-hidden="true" />
      </div>
      {!compact && (
        <p className={`mt-1 text-xs font-medium ${tone}`} aria-live="polite">
          {active ? text[verdict] : text.none}
        </p>
      )}
    </div>
  );
}
