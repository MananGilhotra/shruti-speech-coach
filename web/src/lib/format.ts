/* Number and time formatting helpers (all tolerate null/undefined/NaN). */

export function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function fmt(x: number | null | undefined, digits = 2, fallback = '—'): string {
  return isNum(x) ? x.toFixed(digits) : fallback;
}

export function fmtSigned(x: number | null | undefined, digits = 2, fallback = '—'): string {
  if (!isNum(x)) return fallback;
  return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;
}

export function fmtPct(x: number | null | undefined, digits = 0, fallback = '—'): string {
  return isNum(x) ? `${(x * 100).toFixed(digits)}%` : fallback;
}

/** p / q values: tiny values in scientific notation, zero shown as a bound. */
export function fmtP(x: number | null | undefined): string {
  if (!isNum(x)) return '—';
  if (x === 0) return '< 1e-6';
  if (x < 0.001) return x.toExponential(1);
  return x.toFixed(3);
}

/** Seconds as m:ss.cc (or s.cc s when under a minute and short=true). */
export function fmtTime(t: number | null | undefined, decimals = 2): string {
  if (!isNum(t)) return '—';
  const sign = t < 0 ? '−' : '';
  const a = Math.abs(t);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  const ss = s.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0');
  return `${sign}${m}:${ss}`;
}

export function fmtSec(t: number | null | undefined, decimals = 2): string {
  return isNum(t) ? `${t.toFixed(decimals)} s` : '—';
}

export function fmtDuration(t: number | null | undefined): string {
  if (!isNum(t)) return '—';
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function shortHash(h: string | null | undefined, n = 8): string {
  return h ? h.slice(0, n) : '—';
}

/** "Nice" tick values covering [lo, hi] with roughly `count` ticks. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!isNum(lo) || !isNum(hi) || hi <= lo) return [];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = [1, 2, 2.5, 5, 10];
  const step = (steps.find((s) => s * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
