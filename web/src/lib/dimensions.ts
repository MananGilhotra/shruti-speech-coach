/* Rubric dimensions and flaw types: colours (Okabe–Ito, colour-blind safe), labels and
 * a texture per dimension so colour is never the only cue. */
import type { Dimension, FixOption, FlawType } from '../types';
import { DIMENSIONS } from '../types';

export const DIM_COLOR: Record<Dimension, string> = {
  pacing: '#0072B2',
  pausing: '#E69F00',
  intonation: '#009E73',
  projection: '#CC79A7',
  fluency: '#D55E00',
  clarity: '#56B4E9',
  emphasis: '#9a8a00',
};

export const DIM_LABEL: Record<Dimension, string> = {
  pacing: 'Pacing',
  pausing: 'Pausing',
  intonation: 'Intonation',
  projection: 'Projection',
  fluency: 'Fluency',
  clarity: 'Clarity',
  emphasis: 'Emphasis',
};

export const DIM_BLURB: Record<Dimension, string> = {
  pacing: 'Speed of words within phrases (rushed or dragged).',
  pausing: 'Where and how long you pause between words.',
  intonation: 'Pitch movement — monotone stretches lose the listener.',
  projection: 'Loudness held through the end of phrases.',
  fluency: 'Fillers (“uh”, “um”) and stutters.',
  clarity: 'Articulation — mumbled words lose spectral detail.',
  emphasis: 'Stress on the words that carry the meaning.',
};

/** Texture kinds, one per dimension (secondary encoding for colour-vision deficiency and print). */
type Texture = 'diag' | 'vert' | 'horiz' | 'anti' | 'cross' | 'dots' | 'grid';
export const DIM_TEXTURE: Record<Dimension, Texture> = {
  pacing: 'diag',
  pausing: 'vert',
  intonation: 'horiz',
  projection: 'anti',
  fluency: 'cross',
  clarity: 'dots',
  emphasis: 'grid',
};

export function isDimension(d: string): d is Dimension {
  return (DIMENSIONS as readonly string[]).includes(d);
}

export function dimColor(d: string): string {
  return isDimension(d) ? DIM_COLOR[d] : '#64748b';
}

export function dimLabel(d: string): string {
  return isDimension(d) ? DIM_LABEL[d] : d.charAt(0).toUpperCase() + d.slice(1);
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** CSS background-image hatch for a dimension (used for waveform regions and legend swatches). */
export function cssTexture(d: string, alpha = 0.45): string {
  const c = hexToRgba(dimColor(d), alpha);
  const t = isDimension(d) ? DIM_TEXTURE[d] : 'diag';
  const line = (deg: number) => `repeating-linear-gradient(${deg}deg, ${c} 0 1.5px, transparent 1.5px 7px)`;
  switch (t) {
    case 'diag':
      return line(45);
    case 'anti':
      return line(-45);
    case 'vert':
      return line(90);
    case 'horiz':
      return line(0);
    case 'cross':
      return `${line(45)}, ${line(-45)}`;
    case 'grid':
      return `${line(0)}, ${line(90)}`;
    case 'dots':
      return `radial-gradient(${c} 1.2px, transparent 1.6px)`;
  }
}

export function cssTextureSize(d: string): string {
  return isDimension(d) && DIM_TEXTURE[d] === 'dots' ? '6px 6px' : 'auto';
}

const patternCache = new Map<string, CanvasPattern | null>();

/** Canvas pattern equivalent of cssTexture, cached per dimension/alpha/pixel-ratio. */
export function canvasTexture(ctx: CanvasRenderingContext2D, d: string, alpha: number, dpr: number): CanvasPattern | null {
  const key = `${d}|${alpha}|${dpr}`;
  if (patternCache.has(key)) return patternCache.get(key) ?? null;
  const size = Math.round(8 * dpr);
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const g = tile.getContext('2d');
  if (!g) return null;
  g.strokeStyle = hexToRgba(dimColor(d), alpha);
  g.fillStyle = hexToRgba(dimColor(d), alpha);
  g.lineWidth = 1.2 * dpr;
  const t = isDimension(d) ? DIM_TEXTURE[d] : 'diag';
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  const s = size;
  if (t === 'diag' || t === 'cross') {
    seg(0, s, s, 0);
    seg(-s / 2, s / 2, s / 2, -s / 2);
    seg(s / 2, s * 1.5, s * 1.5, s / 2);
  }
  if (t === 'anti' || t === 'cross') {
    seg(0, 0, s, s);
    seg(-s / 2, s / 2, s / 2, s * 1.5);
    seg(s / 2, -s / 2, s * 1.5, s / 2);
  }
  if (t === 'vert' || t === 'grid') seg(s / 2, 0, s / 2, s);
  if (t === 'horiz' || t === 'grid') seg(0, s / 2, s, s / 2);
  if (t === 'dots') {
    g.beginPath();
    g.arc(s / 2, s / 2, 1.3 * dpr, 0, Math.PI * 2);
    g.fill();
  }
  const p = ctx.createPattern(tile, 'repeat');
  patternCache.set(key, p);
  return p;
}

// ----------------------------------------------------------------------------- flaw types
export const FLAW_TYPE_LABEL: Record<FlawType, string> = {
  rushed: 'Rushed',
  dragged: 'Dragged',
  long_pause: 'Long pause',
  missing_pause: 'Missing pause',
  monotone: 'Monotone',
  volume_fade: 'Volume fade',
  mumble: 'Mumble',
  filler: 'Filler',
  stutter: 'Stutter',
  misplaced_emphasis: 'Misplaced emphasis',
};

export const FLAW_TYPE_DIM: Record<FlawType, Dimension> = {
  rushed: 'pacing',
  dragged: 'pacing',
  long_pause: 'pausing',
  missing_pause: 'pausing',
  monotone: 'intonation',
  volume_fade: 'projection',
  mumble: 'clarity',
  filler: 'fluency',
  stutter: 'fluency',
  misplaced_emphasis: 'emphasis',
};

/** Mirrors coach/ghost.py DEFAULT_FIXES: what the Ghost Coach corrects by default for each flaw type. */
export const DEFAULT_FIXES: Record<FlawType, FixOption[]> = {
  rushed: ['duration'],
  dragged: ['duration'],
  long_pause: ['pause'],
  missing_pause: ['pause'],
  monotone: ['pitch'],
  volume_fade: ['intensity'],
  mumble: ['brightness', 'intensity'],
  filler: ['cut'],
  stutter: ['cut'],
  misplaced_emphasis: ['pitch', 'intensity'],
};

export const FIX_LABEL: Record<FixOption, string> = {
  duration: 'Duration',
  pause: 'Pause',
  pitch: 'Pitch',
  intensity: 'Loudness',
  brightness: 'Brightness',
  cut: 'Cut',
};

export function flawTypeLabel(t: string): string {
  return (FLAW_TYPE_LABEL as Record<string, string>)[t] ?? t.replace(/_/g, ' ');
}

export function flawTypeDim(t: string): Dimension | null {
  return (FLAW_TYPE_DIM as Record<string, Dimension>)[t] ?? null;
}

export function defaultFixes(t: string): FixOption[] {
  return (DEFAULT_FIXES as Record<string, FixOption[]>)[t] ?? ['duration'];
}

/** Within one dimension, the second flaw type is drawn dashed so the two can be told apart. */
export function flawTypeDash(t: string): number[] {
  return ['dragged', 'missing_pause', 'stutter'].includes(t) ? [5, 4] : [];
}
