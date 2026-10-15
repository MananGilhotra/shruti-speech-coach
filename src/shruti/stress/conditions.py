"""Recording-condition stress tests: noise, telephone band, reverberation, MP3, gain.

None of these should create a delivery flaw; they measure how robust detection is.
"""
from __future__ import annotations

import io
import shutil
import subprocess

import numpy as np
import soundfile as sf
import soxr
from scipy import signal

from shruti.dsp import SR

CONDITIONS = {
    "noise_30db": {"kind": "noise", "snr_db": 30, "color": "pink"},
    "noise_20db": {"kind": "noise", "snr_db": 20, "color": "pink"},
    "noise_10db": {"kind": "noise", "snr_db": 10, "color": "white"},
    "phone": {"kind": "phone"},
    "reverb": {"kind": "reverb", "rt60": 0.5, "wet": 0.35},
    "mp3_64k": {"kind": "mp3", "bitrate": "64k"},
    "gain_-12db": {"kind": "gain", "gain_db": -12},
}


def _speech_rms(y: np.ndarray) -> float:
    frames = y[: len(y) // 160 * 160].reshape(-1, 160)
    e = np.sqrt(np.mean(frames ** 2, axis=1))
    active = e[e > np.percentile(e, 40)]
    return float(np.sqrt(np.mean(active ** 2))) if len(active) else float(np.sqrt(np.mean(y ** 2)))


def _pink(n: int, rng: np.random.Generator) -> np.ndarray:
    white = rng.standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return signal.lfilter(b, a, white)


def apply_condition(y: np.ndarray, cond: dict, rng: np.random.Generator) -> np.ndarray:
    kind = cond["kind"]
    y = y.astype(np.float32)
    if kind == "noise":
        n = _pink(len(y), rng) if cond.get("color") == "pink" else rng.standard_normal(len(y))
        n = n / (np.sqrt(np.mean(n ** 2)) + 1e-12)
        return (y + n * _speech_rms(y) * 10 ** (-cond["snr_db"] / 20)).astype(np.float32)
    if kind == "phone":
        sos = signal.butter(6, [300, 3400], btype="band", fs=SR, output="sos")
        z = signal.sosfiltfilt(sos, y)
        z = soxr.resample(soxr.resample(z, SR, 8000), 8000, SR)
        z = np.tanh(2.0 * z / (np.max(np.abs(z)) + 1e-9)) * 0.5        # mild codec-like compression
        return z[: len(y)].astype(np.float32) if len(z) >= len(y) else np.pad(z, (0, len(y) - len(z))).astype(np.float32)
    if kind == "reverb":
        rt60 = cond.get("rt60", 0.5)
        L = int(rt60 * SR)
        t = np.arange(L) / SR
        rir = rng.standard_normal(L) * np.exp(-6.9 * t / rt60)
        rir[0] = 1.0
        rir /= np.sqrt(np.sum(rir ** 2))
        wet = signal.fftconvolve(y, rir)[: len(y)]
        wet *= _speech_rms(y) / (_speech_rms(wet) + 1e-9)
        return ((1 - cond.get("wet", 0.35)) * y + cond.get("wet", 0.35) * wet).astype(np.float32)
    if kind == "mp3":
        if shutil.which("ffmpeg") is None:
            return y
        buf = io.BytesIO()
        sf.write(buf, y, SR, format="WAV", subtype="PCM_16")
        enc = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "wav", "-i", "pipe:0", "-b:a",
                              cond.get("bitrate", "64k"), "-f", "mp3", "pipe:1"],
                             input=buf.getvalue(), capture_output=True, check=True).stdout
        dec = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "mp3", "-i", "pipe:0", "-ac", "1",
                              "-ar", str(SR), "-f", "wav", "pipe:1"], input=enc, capture_output=True,
                             check=True).stdout
        z, _ = sf.read(io.BytesIO(dec), dtype="float32")
        # MP3 adds encoder delay; align by cross-correlation on the first second
        lag = int(np.argmax(signal.correlate(z[: SR * 2], y[: SR], mode="valid"))) if len(z) > SR * 2 else 0
        z = z[lag: lag + len(y)]
        return np.pad(z, (0, max(0, len(y) - len(z)))).astype(np.float32)
    if kind == "gain":
        return (y * 10 ** (cond["gain_db"] / 20)).astype(np.float32)
    raise ValueError(f"unknown condition {kind}")
