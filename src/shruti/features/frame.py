"""Frame-level acoustic features on a common 10 ms grid (frame k is centred at k * hop)."""
from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np
import parselmouth

EPS = 1e-10


@dataclass
class FrameFeatures:
    hop: float
    times: np.ndarray            # [T] seconds
    f0_hz: np.ndarray            # [T] NaN where unvoiced
    intensity_db: np.ndarray     # [T]
    hnr_db: np.ndarray           # [T] NaN where undefined
    cpp_db: np.ndarray           # [T]
    tilt_db: np.ndarray          # [T] alpha ratio: energy 1-5 kHz over 0-1 kHz
    centroid_hz: np.ndarray      # [T]
    energy_db: np.ndarray        # [T] short-window (25 ms) energy, sharper than Praat intensity
    mfcc: np.ndarray             # [n_mfcc, T]
    f0_floor: float
    f0_ceiling: float
    f0_median_hz: float
    intensity_ref_db: float      # median intensity of voiced frames
    silence_threshold_db: float

    @property
    def n(self) -> int:
        return len(self.times)

    @property
    def voiced(self) -> np.ndarray:
        return ~np.isnan(self.f0_hz)

    @property
    def f0_st(self) -> np.ndarray:
        """Pitch in semitones relative to the speaker's median F0 (speaker-normalised)."""
        return 12.0 * np.log2(self.f0_hz / self.f0_median_hz)

    @property
    def int_rel(self) -> np.ndarray:
        """Intensity in dB relative to the speaker's median voiced intensity."""
        return self.intensity_db - self.intensity_ref_db

    @property
    def silent(self) -> np.ndarray:
        return (self.intensity_db < self.silence_threshold_db) & ~self.voiced

    @property
    def quiet(self) -> np.ndarray:
        """Short dips in energy (>= 20 dB under the voiced median): splits bursts and repeated onsets."""
        ref = np.median(self.energy_db[self.voiced]) if self.voiced.sum() > 10 else np.percentile(self.energy_db, 75)
        return self.energy_db < ref - 20.0

    def idx(self, t: float) -> int:
        return int(np.clip(round(t / self.hop), 0, self.n - 1))

    def span(self, a: float, b: float) -> slice:
        i, j = self.idx(a), self.idx(b)
        return slice(i, max(j, i + 1))

    def to_lanes(self, step: int = 2) -> dict:
        """Down-sampled series for the dashboard (JSON friendly, NaN -> None)."""
        def clean(v):
            v = np.asarray(v, dtype=float)[::step]
            return [None if not np.isfinite(a) else round(float(a), 3) for a in v]
        return {
            "t": [round(float(t), 3) for t in self.times[::step]],
            "f0_st": clean(self.f0_st),
            "int_rel": clean(self.int_rel),
            "cpp": clean(self.cpp_db),
        }


def _to_grid(src_t: np.ndarray, src_v: np.ndarray, grid: np.ndarray, hop: float, mode: str) -> np.ndarray:
    out = np.full(len(grid), np.nan)
    if len(src_t) == 0:
        return out
    if mode == "nearest":
        j = np.clip(np.searchsorted(src_t, grid), 1, len(src_t) - 1)
        left_closer = np.abs(grid - src_t[j - 1]) <= np.abs(src_t[j] - grid)
        j = np.where(left_closer, j - 1, j)
        ok = np.abs(src_t[j] - grid) <= hop * 0.75
        out[ok] = src_v[j[ok]]
        return out
    ok = np.isfinite(src_v)
    if ok.sum() < 2:
        return out
    return np.interp(grid, src_t[ok], src_v[ok])


def _cpp(x: np.ndarray, sr: int, hop_n: int, n: int, win_s: float, q_ms: tuple[float, float]) -> np.ndarray:
    """Cepstral peak prominence per frame (Hillenbrand-style, own implementation)."""
    win = int(round(win_s * sr))
    pad = win // 2
    xp = np.pad(x.astype(np.float64), (pad, pad + hop_n * 2))
    frames = librosa.util.frame(xp, frame_length=win, hop_length=hop_n)[:, :n].T  # [n, win]
    frames = frames * np.hanning(win)[None, :]
    nfft = 1 << int(np.ceil(np.log2(win * 2)))
    spec_db = 10.0 * np.log10(np.abs(np.fft.rfft(frames, n=nfft, axis=1)) ** 2 + EPS)
    ceps = np.abs(np.fft.irfft(spec_db, n=nfft, axis=1))
    ceps_db = 20.0 * np.log10(ceps + EPS)
    q = np.arange(nfft) / sr
    lo, hi = int(q_ms[0] / 1000 * sr), int(q_ms[1] / 1000 * sr)
    qr = q[lo:hi]
    seg = ceps_db[:, lo:hi]
    # regression line over the quefrency range, per frame
    A = np.vstack([qr, np.ones_like(qr)]).T
    coef, *_ = np.linalg.lstsq(A, seg.T, rcond=None)          # [2, n]
    k = seg.argmax(axis=1)
    peak = seg[np.arange(len(seg)), k]
    line = coef[0] * qr[k] + coef[1]
    return (peak - line).astype(np.float64)


def extract_frames(x: np.ndarray, sr: int, cfg: dict) -> FrameFeatures:
    fc = cfg["features"]
    hop = float(fc["hop_s"])
    hop_n = int(round(hop * sr))
    n = int(np.ceil(len(x) / hop_n)) + 1
    grid = np.arange(n) * hop
    snd = parselmouth.Sound(x.astype(np.float64), sampling_frequency=sr)

    # Two-pass pitch range per speaker (De Looze & Hirst 2008): floor 0.75*Q1, ceiling 1.75*Q3.
    p1 = snd.to_pitch_ac(time_step=hop, pitch_floor=fc["f0_floor_hz"], pitch_ceiling=fc["f0_ceiling_hz"])
    f1 = p1.selected_array["frequency"]
    v1 = f1[f1 > 0]
    if len(v1) >= 20:
        q1, q3 = np.percentile(v1, [25, 75])
        floor, ceiling = max(50.0, 0.75 * q1), min(700.0, 1.75 * q3)
    else:
        floor, ceiling = float(fc["f0_floor_hz"]), float(fc["f0_ceiling_hz"])
    pitch = snd.to_pitch_ac(time_step=hop, pitch_floor=floor, pitch_ceiling=ceiling)
    fv = pitch.selected_array["frequency"].astype(np.float64)
    fv[fv <= 0] = np.nan
    f0 = _to_grid(np.asarray(pitch.xs()), fv, grid, hop, "nearest")

    inten = snd.to_intensity(minimum_pitch=100.0, time_step=hop)
    iv = inten.values[0].astype(np.float64)
    intensity = _to_grid(np.asarray(inten.xs()), iv, grid, hop, "linear")
    if np.isnan(intensity).all():
        intensity = np.zeros(n)
    intensity = np.where(np.isnan(intensity), np.nanmin(intensity), intensity)

    harm = snd.to_harmonicity_cc(time_step=hop, minimum_pitch=max(75.0, floor))
    hv = harm.values[0].astype(np.float64)
    hv[hv < -100] = np.nan
    hnr = _to_grid(np.asarray(harm.xs()), hv, grid, hop, "nearest")

    S = np.abs(librosa.stft(x, n_fft=fc["n_fft"], hop_length=hop_n, win_length=fc["win_length"],
                            center=True)) ** 2
    S = S[:, :n]
    if S.shape[1] < n:
        S = np.pad(S, ((0, 0), (0, n - S.shape[1])), mode="edge")
    freqs = librosa.fft_frequencies(sr=sr, n_fft=fc["n_fft"])
    low = S[(freqs >= 50) & (freqs < 1000)].sum(axis=0)
    high = S[(freqs >= 1000) & (freqs < 5000)].sum(axis=0)
    tilt = 10.0 * np.log10((high + EPS) / (low + EPS))
    centroid = (freqs[:, None] * S).sum(axis=0) / (S.sum(axis=0) + EPS)
    energy = 10.0 * np.log10(S.sum(axis=0) + EPS)
    mel = librosa.feature.melspectrogram(S=S, sr=sr, n_mels=fc["n_mels"])
    mfcc = librosa.feature.mfcc(S=librosa.power_to_db(mel + EPS), n_mfcc=fc["n_mfcc"])
    cpp = _cpp(x, sr, hop_n, n, fc["cpp_window_s"], tuple(fc["cpp_quefrency_ms"]))

    voiced = ~np.isnan(f0)
    f0_med = float(np.nanmedian(f0)) if voiced.any() else 120.0
    int_ref = float(np.median(intensity[voiced])) if voiced.sum() > 10 else float(np.percentile(intensity, 75))
    # Silence threshold adapts to the noise floor: in a clean recording it sits
    # `silence_db_below_median` under the voiced median; in a noisy one it rises toward the floor.
    floor_db = float(np.percentile(intensity, 5))
    sil_thr = min(int_ref - float(fc["silence_db_below_median"]) if int_ref - floor_db > 2 * float(
        fc["silence_db_below_median"]) else floor_db + 0.55 * (int_ref - floor_db), int_ref - 6.0)
    return FrameFeatures(hop=hop, times=grid, f0_hz=f0, intensity_db=intensity, hnr_db=hnr, cpp_db=cpp,
                         tilt_db=tilt, centroid_hz=centroid, energy_db=energy, mfcc=mfcc, f0_floor=floor, f0_ceiling=ceiling,
                         f0_median_hz=f0_med, intensity_ref_db=int_ref, silence_threshold_db=sil_thr)
