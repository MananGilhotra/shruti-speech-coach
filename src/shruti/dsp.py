"""Shared signal-processing primitives: PSOLA manipulation, time maps, splicing, filters."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import parselmouth
from parselmouth.praat import call
from scipy import signal

SR = 16000


# --------------------------------------------------------------------------- time maps
@dataclass
class TimeMap:
    """Monotone piecewise-linear map from source time to rendered time."""
    src: np.ndarray = field(default_factory=lambda: np.array([0.0, 1e6]))
    dst: np.ndarray = field(default_factory=lambda: np.array([0.0, 1e6]))

    def __call__(self, t):
        return np.interp(t, self.src, self.dst)

    def then(self, other: "TimeMap") -> "TimeMap":
        """Composition: first self, then other (keeps the breakpoints of both)."""
        inv = np.interp(other.src, self.dst, self.src)
        src = np.unique(np.concatenate([self.src, inv]))
        return TimeMap(src, other(self(src)))

    @staticmethod
    def insertion(t0: float, d: float) -> "TimeMap":
        """Everything at or after t0 moves right by d."""
        return TimeMap(np.array([0.0, t0 - 1e-7, t0, 1e6]), np.array([0.0, t0 - 1e-7, t0 + d, 1e6 + d]))

    @staticmethod
    def deletion(a: float, b: float) -> "TimeMap":
        return TimeMap(np.array([0.0, a, b, 1e6]), np.array([0.0, a, a, 1e6 - (b - a)]))


def duration_map(points: list[tuple[float, float]], total: float, step: float = 0.001) -> TimeMap:
    """Rendered time = integral of Praat's DurationTier (linear between points, constant outside)."""
    if not points:
        return TimeMap()
    pts = sorted(points)
    pt, pf = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
    grid = np.arange(0.0, total + step * 2, step)
    f = np.interp(grid, pt, pf)
    dst = np.concatenate([[0.0], np.cumsum(0.5 * (f[1:] + f[:-1]) * step)])
    grid = np.append(grid, grid[-1] + 1e6)
    dst = np.append(dst, dst[-1] + 1e6 * f[-1])
    return TimeMap(grid, dst)


def compress_points(grid: np.ndarray, values: np.ndarray, tol: float = 1e-6) -> list[tuple[float, float]]:
    """Keep only the breakpoints of a piecewise-linear factor curve."""
    if len(grid) < 3:
        return list(zip(grid.tolist(), values.tolist()))
    d2 = np.abs(np.diff(values, 2))
    keep = np.concatenate([[True], d2 > tol, [True]])
    return list(zip(grid[keep].tolist(), values[keep].tolist()))


# --------------------------------------------------------------------------- PSOLA
def psola(x: np.ndarray, floor: float, ceiling: float, dur_points: list[tuple[float, float]] | None = None,
          pitch_fn=None, sr: int = SR) -> tuple[np.ndarray, TimeMap]:
    """Overlap-add resynthesis with an optional DurationTier and a pitch-contour function.

    pitch_fn(times, hz) -> new_hz is applied to the Manipulation's pitch tier.
    """
    snd = parselmouth.Sound(x.astype(np.float64), sampling_frequency=sr)
    manip = call(snd, "To Manipulation", 0.01, float(floor), float(ceiling))
    if pitch_fn is not None:
        pt = call(manip, "Extract pitch tier")
        n = int(call(pt, "Get number of points"))
        if n > 0:
            ts = np.array([call(pt, "Get time from index", i) for i in range(1, n + 1)])
            vs = np.array([call(pt, "Get value at index", i) for i in range(1, n + 1)])
            new = np.clip(pitch_fn(ts, vs), 40.0, 900.0)
            call(pt, "Remove points between", snd.xmin, snd.xmax)
            for t, v in zip(ts, new):
                call(pt, "Add point", float(t), float(v))
            call([pt, manip], "Replace pitch tier")
    if dur_points:
        dt = call("Create DurationTier", "dur", snd.xmin, snd.xmax)
        for t, f in dur_points:
            call(dt, "Add point", float(t), float(f))
        call([dt, manip], "Replace duration tier")
    out = call(manip, "Get resynthesis (overlap-add)")
    y = np.asarray(out.values[0], dtype=np.float32)
    return y, duration_map(dur_points or [], len(x) / sr)


def change_voice(x: np.ndarray, floor: float, ceiling: float, formant_ratio: float, pitch_median_hz: float,
                 sr: int = SR) -> np.ndarray:
    """Praat 'Change gender': new timbre (formants) and pitch median, same prosodic shape and timing."""
    snd = parselmouth.Sound(x.astype(np.float64), sampling_frequency=sr)
    out = call(snd, "Change gender", float(floor), float(ceiling), float(formant_ratio),
               float(pitch_median_hz), 1.0, 1.0)
    y = np.asarray(out.values[0], dtype=np.float32)
    return y[: len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))


# --------------------------------------------------------------------------- splicing
def fade(seg: np.ndarray, fade_s: float, sr: int = SR) -> np.ndarray:
    n = min(int(fade_s * sr), len(seg) // 2)
    if n <= 0:
        return seg
    seg = seg.copy()
    ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))
    seg[:n] *= ramp
    seg[-n:] *= ramp[::-1]
    return seg


def insert(y: np.ndarray, t: float, seg: np.ndarray, sr: int = SR, edge_fade_s: float = 0.005) -> np.ndarray:
    i = int(round(t * sr))
    i = max(0, min(i, len(y)))
    left, right = y[:i].copy(), y[i:].copy()
    n = int(edge_fade_s * sr)
    if n and len(left) > n:
        left[-n:] *= np.linspace(1, 0.2, n)
    if n and len(right) > n:
        right[:n] *= np.linspace(0.2, 1, n)
    return np.concatenate([left, fade(seg, edge_fade_s * 2, sr), right]).astype(np.float32)


def delete(y: np.ndarray, a: float, b: float, sr: int = SR, xfade_s: float = 0.01) -> np.ndarray:
    ia, ib = int(round(a * sr)), int(round(b * sr))
    n = int(xfade_s * sr)
    if ib - ia <= 2 * n or ia < n or ib + n > len(y):
        return np.concatenate([y[:ia], y[ib:]]).astype(np.float32)
    ramp = np.linspace(1, 0, n)
    mixed = y[ia - n:ia] * ramp + y[ib:ib + n] * (1 - ramp)
    return np.concatenate([y[:ia - n], mixed, y[ib + n:]]).astype(np.float32)


def gain_envelope(n: int, spans: list[tuple[float, float, np.ndarray | float]], sr: int = SR,
                  ramp_s: float = 0.02) -> np.ndarray:
    """Linear-gain envelope (1 outside spans). Each span: (start_s, end_s, dB value or dB curve)."""
    db = np.zeros(n)
    for a, b, val in spans:
        ia, ib = max(0, int(a * sr)), min(n, int(b * sr))
        if ib <= ia:
            continue
        curve = np.full(ib - ia, float(val)) if np.isscalar(val) else np.interp(
            np.linspace(0, 1, ib - ia), np.linspace(0, 1, len(val)), val)
        db[ia:ib] += curve
    if ramp_s > 0:
        k = max(1, int(ramp_s * sr))
        db = np.convolve(db, np.ones(k) / k, mode="same")
    return (10 ** (db / 20.0)).astype(np.float32)


def lowpass(x: np.ndarray, cutoff: float, sr: int = SR, order: int = 4) -> np.ndarray:
    sos = signal.butter(order, min(cutoff, sr / 2 - 100), btype="low", fs=sr, output="sos")
    return signal.sosfiltfilt(sos, x).astype(np.float32)


def bandpass_noise(n: int, lo: float, hi: float, rng: np.random.Generator, sr: int = SR) -> np.ndarray:
    sos = signal.butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    return signal.sosfilt(sos, rng.standard_normal(n)).astype(np.float32)


def crossfade_replace(y: np.ndarray, a: float, b: float, new: np.ndarray, sr: int = SR,
                      xf_s: float = 0.015) -> np.ndarray:
    """Replace y[a:b] by new[a:b] (same length signals) with raised-cosine crossfades at the edges."""
    out = y.copy()
    ia, ib = max(0, int(a * sr)), min(len(y), int(b * sr))
    w = np.zeros(len(y))
    w[ia:ib] = 1.0
    k = max(1, int(xf_s * sr))
    w = np.convolve(w, np.ones(k) / k, mode="same")
    return (out * (1 - w) + new * w).astype(np.float32)


def room_tone(x: np.ndarray, silent_mask: np.ndarray, hop: float, d: float, rng: np.random.Generator,
              sr: int = SR) -> np.ndarray:
    """`d` seconds of the recording's own background sound, stitched from its silent stretches."""
    n_out = int(round(d * sr))
    if n_out <= 0:
        return np.zeros(0, np.float32)
    pieces = []
    run = None
    for i, s in enumerate(np.append(silent_mask, False)):
        if s and run is None:
            run = i
        elif not s and run is not None:
            if (i - run) * hop >= 0.06:
                a, b = int(run * hop * sr) + 80, int(i * hop * sr) - 80
                if b - a > 400:
                    pieces.append(x[a:b])
            run = None
    if not pieces:
        noise = rng.standard_normal(n_out).astype(np.float32)
        floor = np.percentile(np.abs(x), 5) + 1e-5
        return noise * floor
    out = np.zeros(0, np.float32)
    xf = int(0.01 * sr)
    while len(out) < n_out:
        p = pieces[int(rng.integers(len(pieces)))]
        if len(out) >= xf and len(p) > 2 * xf:
            ramp = np.linspace(0, 1, xf)
            out[-xf:] = out[-xf:] * (1 - ramp) + p[:xf] * ramp
            out = np.concatenate([out, p[xf:]])
        else:
            out = np.concatenate([out, p])
    return out[:n_out].astype(np.float32)
