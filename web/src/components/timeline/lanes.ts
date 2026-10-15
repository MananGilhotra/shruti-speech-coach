/* Canvas renderer for the stacked feature lanes under the waveform. Pure drawing: everything it
 * needs is passed in, so the Timeline can redraw on every scroll/zoom/hover frame cheaply. */
import type { Analysis, FlawCard, Word } from '../../types';
import { canvasTexture, dimColor, flawTypeDim, flawTypeLabel, hexToRgba } from '../../lib/dimensions';
import { isNum, quantile } from '../../lib/format';

export type LaneKey = 'truth' | 'words' | 'pitch' | 'loudness' | 'rate' | 'pauses' | 'clarity';

export interface LaneDef {
  key: LaneKey;
  label: string;
  unit: string;
  height: number;
  description: string;
}

export const LANE_DEFS: LaneDef[] = [
  {
    key: 'truth',
    label: 'Injected',
    unit: '',
    height: 24,
    description: 'Ground truth for benchmark demos: where flaws were injected (dashed), to compare with what SHRUTI flagged.',
  },
  { key: 'words', label: 'Words', unit: '', height: 30, description: 'Aligned words; flagged words are filled in their dimension colour.' },
  {
    key: 'pitch',
    label: 'Pitch',
    unit: 'st',
    height: 92,
    description: 'Your pitch contour in semitones relative to your median, against the reference expectation (mean ± 1 SD per word).',
  },
  {
    key: 'loudness',
    label: 'Loudness',
    unit: 'dB',
    height: 72,
    description: 'Your intensity relative to your typical level, against the reference expectation per word.',
  },
  {
    key: 'rate',
    label: 'Rate',
    unit: 'syl/s',
    height: 58,
    description: 'Syllables per second for each word; the amber tick is the expected rate (syllables ÷ reference duration).',
  },
  {
    key: 'pauses',
    label: 'Pauses',
    unit: 's',
    height: 54,
    description: 'Silence after each word; the amber outline is the pause the reference makes there.',
  },
  {
    key: 'clarity',
    label: 'Clarity',
    unit: 'dB',
    height: 50,
    description: 'Cepstral peak prominence (CPP): lower values mean a breathier or mumbled voice.',
  },
];

export const ACCENT = '#3730a3';
export const REF = '#b45309';

export interface Scales {
  pitch: [number, number];
  loudness: [number, number];
  rate: [number, number];
  pauses: [number, number];
  clarity: [number, number];
}

export function computeScales(a: Analysis): Scales {
  const f0 = a.lanes.f0_st.filter(isNum).sort((x, y) => x - y);
  // loudness range from voiced frames only, so long silences do not squash the speech
  const loud = a.lanes.int_rel
    .filter((v, i): v is number => isNum(v) && isNum(a.lanes.f0_st[i]))
    .sort((x, y) => x - y);
  const cpp = (a.lanes.cpp ?? []).filter(isNum).sort((x, y) => x - y);
  let pLo = f0.length ? quantile(f0, 0.01) : -6;
  let pHi = f0.length ? quantile(f0, 0.99) : 6;
  let lLo = loud.length ? quantile(loud, 0.02) : -20;
  let lHi = loud.length ? loud[loud.length - 1] : 10;
  let rHi = 6;
  let pauseHi = 0.8;
  for (const w of a.words) {
    const r = w.ref;
    if (r?.f0_med_st && isNum(r.f0_med_st.m)) {
      pLo = Math.min(pLo, r.f0_med_st.m - (r.f0_med_st.sd || 0));
      pHi = Math.max(pHi, r.f0_med_st.m + (r.f0_med_st.sd || 0));
    }
    if (r?.int_med_db && isNum(r.int_med_db.m)) {
      lLo = Math.min(lLo, r.int_med_db.m - (r.int_med_db.sd || 0));
      lHi = Math.max(lHi, r.int_med_db.m + (r.int_med_db.sd || 0));
    }
    if (isNum(w.rate)) rHi = Math.max(rHi, Math.min(w.rate, 14));
    const exp = expectedRate(w);
    if (exp != null) rHi = Math.max(rHi, Math.min(exp, 14));
    if (isNum(w.pause_after)) pauseHi = Math.max(pauseHi, w.pause_after);
    if (r && isNum(r.pause_after)) pauseHi = Math.max(pauseHi, r.pause_after);
  }
  const cLo = cpp.length ? quantile(cpp, 0.01) : 0;
  const cHi = cpp.length ? quantile(cpp, 0.995) : 30;
  return {
    pitch: [Math.floor(pLo - 0.5), Math.ceil(pHi + 0.5)],
    loudness: [Math.floor(lLo - 2), Math.ceil(lHi + 1)],
    rate: [0, Math.ceil(rHi * 1.08)],
    pauses: [0, Math.min(4, Math.ceil(pauseHi * 1.15 * 4) / 4)],
    clarity: [Math.floor(cLo - 1), Math.ceil(cHi + 1)],
  };
}

/** Which lanes carry the evidence for a flaw card (so the timeline can point at the cause). */
export function evidenceLanes(card: FlawCard | null | undefined): LaneKey[] {
  if (!card) return [];
  const f = card.stats?.family ?? '';
  const t = String(card.type);
  if (f === 'pause' || t === 'long_pause' || t === 'missing_pause') return ['pauses'];
  if (f === 'tempo' || t === 'rushed' || t === 'dragged') return ['rate'];
  if (f === 'monotone' || t === 'monotone') return ['pitch'];
  if (f === 'level' || t === 'volume_fade') return ['loudness'];
  if (f === 'clarity' || t === 'mumble') return ['clarity'];
  if (f === 'emphasis' || t === 'misplaced_emphasis') return ['pitch', 'loudness'];
  if (f === 'fluency' || t === 'filler' || t === 'stutter') return ['words'];
  return [];
}

export function expectedRate(w: Word): number | null {
  const d = w.ref?.dur;
  return isNum(d) && d > 0 && w.n_syl > 0 ? w.n_syl / d : null;
}

/** Index of the word whose [start, end] (or following pause) contains t; -1 if before the first word. */
export function wordAt(words: Word[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface LaneBox {
  key: LaneKey;
  y: number;
  h: number;
}

export function layoutLanes(visible: LaneKey[]): { boxes: LaneBox[]; height: number } {
  let y = 0;
  const boxes: LaneBox[] = [];
  for (const d of LANE_DEFS) {
    if (!visible.includes(d.key)) continue;
    boxes.push({ key: d.key, y, h: d.height });
    y += d.height;
  }
  return { boxes, height: y };
}

export interface DrawInput {
  analysis: Analysis;
  scales: Scales;
  boxes: LaneBox[];
  width: number;
  height: number;
  dpr: number;
  t0: number;
  t1: number;
  cards: FlawCard[];
  selectedId: string | null;
  highlightDim: string | null;
  hoverT: number | null;
  hoverWord: number;
  flagged: Map<number, string>;
  /** Lanes holding the evidence of the selected card; its band is emphasised there. */
  evidence: LaneKey[];
}

const FONT = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_BOLD = '600 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const PAD = 5; // vertical padding inside a lane

export function drawLanes(ctx: CanvasRenderingContext2D, p: DrawInput) {
  const { width: W, height: H, dpr, t0, t1 } = p;
  const span = Math.max(1e-6, t1 - t0);
  const x = (t: number) => ((t - t0) / span) * W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // lane backgrounds + separators
  p.boxes.forEach((b, i) => {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#fbfcfd';
    ctx.fillRect(0, b.y, W, b.h);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, b.y, W, 1);
  });

  // flaw regions span every lane
  for (const c of p.cards) {
    const xa = x(c.t_start);
    const xb = x(c.t_end);
    if (xb < 0 || xa > W) continue;
    const sel = c.id === p.selectedId;
    const dimmed = p.highlightDim != null && p.highlightDim !== c.dimension;
    const k = dimmed ? 0.35 : 1;
    const col = dimColor(c.dimension);
    ctx.fillStyle = hexToRgba(col, (sel ? 0.13 : 0.08) * k);
    ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
    const pat = canvasTexture(ctx, c.dimension, (sel ? 0.34 : 0.24) * k, dpr);
    if (pat) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = pat;
      ctx.fillRect(xa * dpr, 0, Math.max(2, xb - xa) * dpr, H * dpr);
      ctx.restore();
    }
    ctx.fillStyle = hexToRgba(col, (sel ? 0.95 : 0.6) * k);
    ctx.fillRect(xa, 0, sel ? 2 : 1, H);
    ctx.fillRect(xb - (sel ? 2 : 1), 0, sel ? 2 : 1, H);
    // bootstrap confidence intervals of the boundaries, drawn as whiskers at the top
    if (sel) {
      ctx.fillStyle = hexToRgba(col, 0.9);
      for (const ci of [c.ci_start, c.ci_end]) {
        if (!ci || !isNum(ci[0]) || !isNum(ci[1])) continue;
        const ca = x(ci[0]);
        const cb = x(ci[1]);
        ctx.fillRect(ca, 2, Math.max(1, cb - ca), 2);
        ctx.fillRect(ca, 0, 1, 6);
        ctx.fillRect(cb, 0, 1, 6);
      }
    }
  }

  // emphasise the selected flaw inside the lane(s) that carry its evidence
  const sel = p.cards.find((c) => c.id === p.selectedId);
  if (sel && p.evidence.length) {
    const xa = x(sel.t_start);
    const xb = x(sel.t_end);
    for (const b of p.boxes) {
      if (!p.evidence.includes(b.key)) continue;
      ctx.fillStyle = hexToRgba(dimColor(sel.dimension), 0.14);
      ctx.fillRect(xa, b.y + 1, Math.max(2, xb - xa), b.h - 1);
      ctx.fillStyle = hexToRgba(dimColor(sel.dimension), 0.9);
      ctx.fillRect(xa, b.y + 1, Math.max(2, xb - xa), 2);
    }
  }

  const words = p.analysis.words;
  const visibleWords: Word[] = [];
  for (const w of words) if (w.end >= t0 - 1 && w.start <= t1 + 1) visibleWords.push(w);

  for (const b of p.boxes) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, b.y + 1, W, b.h - 1);
    ctx.clip();
    switch (b.key) {
      case 'truth':
        drawTruth(ctx, b, x, p);
        break;
      case 'words':
        drawWords(ctx, visibleWords, b, x, p);
        break;
      case 'pitch':
        drawContourLane(ctx, b, x, p, p.scales.pitch, p.analysis.lanes.f0_st, 'pitch');
        break;
      case 'loudness':
        drawContourLane(ctx, b, x, p, p.scales.loudness, p.analysis.lanes.int_rel, 'loudness');
        break;
      case 'clarity':
        drawContourLane(ctx, b, x, p, p.scales.clarity, p.analysis.lanes.cpp ?? [], 'clarity');
        break;
      case 'rate':
        drawRate(ctx, visibleWords, b, x, p);
        break;
      case 'pauses':
        drawPauses(ctx, visibleWords, words, b, x, p);
        break;
    }
    ctx.restore();
  }

  // hover crosshair
  if (p.hoverT != null && p.hoverT >= t0 && p.hoverT <= t1) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.fillRect(Math.round(x(p.hoverT)), 0, 1, H);
  }
}

function yScale(b: LaneBox, range: [number, number]) {
  const [lo, hi] = range;
  const top = b.y + PAD;
  const bottom = b.y + b.h - PAD;
  return (v: number) => bottom - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (bottom - top);
}

function drawTruth(ctx: CanvasRenderingContext2D, b: LaneBox, x: (t: number) => number, p: DrawInput) {
  const labels = p.analysis.demo?.labels ?? [];
  const top = b.y + 4;
  const h = b.h - 8;
  ctx.textBaseline = 'middle';
  ctx.font = FONT_BOLD;
  for (const l of labels) {
    if (!isNum(l.t_start) || !isNum(l.t_end)) continue;
    const xa = x(l.t_start);
    const xb = x(l.t_end);
    if (xb < 0 || xa > p.width) continue;
    const d = flawTypeDim(String(l.type));
    const col = d ? dimColor(d) : '#334155';
    const w = Math.max(3, xb - xa);
    ctx.fillStyle = hexToRgba(col, 0.12);
    ctx.fillRect(xa, top, w, h);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(xa + 0.75, top + 0.75, w - 1.5, h - 1.5);
    ctx.setLineDash([]);
    const text = `${flawTypeLabel(String(l.type))}${isNum(l.level) ? ` L${l.level}` : ''}`;
    const tw = ctx.measureText(text).width;
    if (tw + 8 <= w) {
      ctx.fillStyle = '#0f172a';
      ctx.fillText(text, xa + 4, top + h / 2 + 0.5);
    } else if (xb + tw + 6 < p.width) {
      ctx.fillStyle = '#334155';
      ctx.fillText(text, xb + 4, top + h / 2 + 0.5);
    }
  }
}

function drawWords(
  ctx: CanvasRenderingContext2D,
  words: Word[],
  b: LaneBox,
  x: (t: number) => number,
  p: DrawInput,
) {
  const top = b.y + 5;
  const h = b.h - 9;
  ctx.textBaseline = 'middle';
  for (const w of words) {
    const xa = x(w.start);
    const xb = x(w.end);
    const wpx = Math.max(1, xb - xa - 1);
    const dim = p.flagged.get(w.i);
    const hovered = w.i === p.hoverWord;
    if (dim) {
      ctx.fillStyle = hexToRgba(dimColor(dim), p.highlightDim && p.highlightDim !== dim ? 0.12 : 0.28);
      ctx.strokeStyle = dimColor(dim);
    } else {
      ctx.fillStyle = hovered ? '#e0e7ff' : '#f1f5f9';
      ctx.strokeStyle = hovered ? ACCENT : '#cbd5e1';
    }
    ctx.lineWidth = 1;
    roundRect(ctx, xa + 0.5, top + 0.5, wpx, h, 3);
    ctx.fill();
    if (wpx > 3) ctx.stroke();
    if (hovered && dim) {
      ctx.strokeStyle = ACCENT;
      ctx.stroke();
    }
    ctx.font = dim ? FONT_BOLD : FONT;
    const label = w.word;
    const tw = ctx.measureText(label).width;
    if (tw + 6 <= wpx) {
      ctx.fillStyle = '#0f172a';
      ctx.fillText(label, xa + (wpx - tw) / 2 + 0.5, top + h / 2 + 0.5);
    } else if (wpx > 18) {
      // truncate with an ellipsis rather than overflowing the word box
      let s = label;
      while (s.length > 1 && ctx.measureText(`${s}…`).width + 4 > wpx) s = s.slice(0, -1);
      ctx.fillStyle = '#334155';
      ctx.fillText(`${s}…`, xa + 2.5, top + h / 2 + 0.5);
    }
  }
}

function drawContourLane(
  ctx: CanvasRenderingContext2D,
  b: LaneBox,
  x: (t: number) => number,
  p: DrawInput,
  range: [number, number],
  values: (number | null)[],
  kind: 'pitch' | 'loudness' | 'clarity',
) {
  const y = yScale(b, range);
  // reference line at 0 (your median) for relative lanes
  if (kind !== 'clarity' && range[0] < 0 && range[1] > 0) {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, Math.round(y(0)), p.width, 1);
  }
  // reference expectation per word: mean ± 1 SD band and the mean line
  if (kind !== 'clarity') {
    for (const w of p.analysis.words) {
      if (w.end < p.t0 || w.start > p.t1) continue;
      const r = kind === 'pitch' ? w.ref?.f0_med_st : w.ref?.int_med_db;
      if (!r || !isNum(r.m)) continue;
      const sd = isNum(r.sd) ? r.sd : 0;
      const xa = x(w.start);
      const xb = x(w.end);
      const ya = y(r.m + sd);
      const yb = y(r.m - sd);
      ctx.fillStyle = 'rgba(180, 83, 9, 0.13)';
      ctx.fillRect(xa, ya, Math.max(1, xb - xa), Math.max(1, yb - ya));
      ctx.fillStyle = 'rgba(180, 83, 9, 0.85)';
      ctx.fillRect(xa, Math.round(y(r.m)) - 0.5, Math.max(1, xb - xa), 1.5);
    }
  }
  // your contour (null = unvoiced/no data -> gap)
  const t = p.analysis.lanes.t;
  if (!t.length || !values.length) return;
  const step = t.length > 1 ? t[1] - t[0] : 0.02;
  const i0 = Math.max(0, Math.floor((p.t0 - t[0]) / step) - 1);
  const i1 = Math.min(values.length - 1, Math.ceil((p.t1 - t[0]) / step) + 1);
  const baseY = b.y + b.h - PAD;
  if (kind === 'loudness') {
    // light area wash under the loudness curve
    ctx.beginPath();
    let open = false;
    let lastX = 0;
    for (let i = i0; i <= i1; i++) {
      const v = values[i];
      const xi = x(t[i]);
      if (!isNum(v)) {
        if (open) {
          ctx.lineTo(lastX, baseY);
          ctx.closePath();
          open = false;
        }
        continue;
      }
      if (!open) {
        ctx.moveTo(xi, baseY);
        open = true;
      }
      ctx.lineTo(xi, y(v));
      lastX = xi;
    }
    if (open) {
      ctx.lineTo(lastX, baseY);
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(55, 48, 163, 0.10)';
    ctx.fill();
  }
  ctx.beginPath();
  let pen = false;
  for (let i = i0; i <= i1; i++) {
    const v = values[i];
    if (!isNum(v)) {
      pen = false;
      continue;
    }
    const xi = x(t[i]);
    const yi = y(v);
    if (pen) ctx.lineTo(xi, yi);
    else ctx.moveTo(xi, yi);
    pen = true;
  }
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = kind === 'pitch' ? 2 : 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawRate(ctx: CanvasRenderingContext2D, words: Word[], b: LaneBox, x: (t: number) => number, p: DrawInput) {
  const y = yScale(b, p.scales.rate);
  const base = y(0);
  for (const w of words) {
    const xa = x(w.start);
    const xb = x(w.end);
    const wpx = Math.max(1, xb - xa - 2);
    if (isNum(w.rate)) {
      const flaggedDim = p.flagged.get(w.i);
      ctx.fillStyle = flaggedDim ? 'rgba(55, 48, 163, 0.78)' : 'rgba(55, 48, 163, 0.45)';
      const yt = y(w.rate);
      roundRectTop(ctx, xa + 1, yt, wpx, base - yt, Math.min(3, wpx / 2));
      ctx.fill();
    }
    const e = expectedRate(w);
    if (e != null) {
      ctx.fillStyle = REF;
      ctx.fillRect(xa + 1, Math.round(y(e)) - 1, wpx, 2);
    }
  }
}

function drawPauses(
  ctx: CanvasRenderingContext2D,
  words: Word[],
  all: Word[],
  b: LaneBox,
  x: (t: number) => number,
  p: DrawInput,
) {
  const y = yScale(b, p.scales.pauses);
  const base = y(0);
  for (const w of words) {
    const next = all[w.i + 1];
    const yours = isNum(w.pause_after) ? w.pause_after : null;
    const exp = w.ref && isNum(w.ref.pause_after) ? w.ref.pause_after : null;
    if ((yours ?? 0) < 0.03 && (exp ?? 0) < 0.03) continue;
    const xa = x(w.end);
    const gapEnd = next ? next.start : w.end + Math.max(yours ?? 0, 0.1);
    let xb = x(Math.max(gapEnd, w.end + (yours ?? 0)));
    if (xb - xa < 5) xb = xa + 5;
    if (yours != null && yours >= 0.03) {
      const yt = y(yours);
      ctx.fillStyle = p.flagged.has(w.i) ? 'rgba(55, 48, 163, 0.8)' : 'rgba(55, 48, 163, 0.5)';
      roundRectTop(ctx, xa + 1, yt, xb - xa - 2, base - yt, 2);
      ctx.fill();
    }
    if (exp != null && exp >= 0.03) {
      const ye = y(exp);
      ctx.strokeStyle = REF;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(xa + 1.5, ye, xb - xa - 3, base - ye);
      ctx.setLineDash([]);
    } else if (yours != null && yours >= 0.03) {
      // the reference does not pause here: mark the expected 0 with a short amber cap at the baseline
      ctx.fillStyle = REF;
      ctx.fillRect(xa + 1, base - 1, xb - xa - 2, 2);
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Bar with rounded data-end (top) and a square baseline. */
function roundRectTop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}
