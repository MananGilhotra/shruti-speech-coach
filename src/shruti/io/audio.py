"""Audio loading, saving and hashing. Everything internal runs at 16 kHz mono float32."""
from __future__ import annotations

import hashlib
import io
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

SR = 16000


def _decode_with_ffmpeg(path: str | Path, sr: int) -> np.ndarray:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(f"Cannot decode {path}: install ffmpeg for this format")
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "wav", "-"]
    out = subprocess.run(cmd, check=True, capture_output=True).stdout
    x, _ = sf.read(io.BytesIO(out), dtype="float32")
    return x


def load_audio(path: str | Path, sr: int = SR, start: float | None = None, end: float | None = None) -> np.ndarray:
    """Load any audio file as mono float32 at `sr`, optionally cropped to [start, end] seconds."""
    try:
        x, file_sr = sf.read(str(path), dtype="float32", always_2d=True)
        x = x.mean(axis=1)
        if file_sr != sr:
            x = soxr.resample(x, file_sr, sr, quality="HQ").astype(np.float32)
    except (sf.LibsndfileError, RuntimeError, TypeError):
        x = _decode_with_ffmpeg(path, sr)
    if start is not None or end is not None:
        a = int(round((start or 0.0) * sr))
        b = int(round(end * sr)) if end is not None else len(x)
        x = x[a:b]
    x = x - float(np.mean(x)) if len(x) else x
    return np.ascontiguousarray(x, dtype=np.float32)


def load_audio_bytes(data: bytes, sr: int = SR) -> np.ndarray:
    """Decode uploaded bytes (wav/flac/ogg via libsndfile, anything else via ffmpeg)."""
    try:
        x, file_sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
        x = x.mean(axis=1)
        if file_sr != sr:
            x = soxr.resample(x, file_sr, sr, quality="HQ").astype(np.float32)
    except (sf.LibsndfileError, RuntimeError, TypeError):
        if shutil.which("ffmpeg") is None:
            raise
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(sr), "-f", "wav", "-"],
            input=data, check=True, capture_output=True,
        )
        x, _ = sf.read(io.BytesIO(proc.stdout), dtype="float32")
    x = x - float(np.mean(x)) if len(x) else x
    return np.ascontiguousarray(x, dtype=np.float32)


def peak_normalize(x: np.ndarray, peak_dbfs: float = -1.0) -> np.ndarray:
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    if peak <= 1e-9:
        return x
    return (x * (10 ** (peak_dbfs / 20.0) / peak)).astype(np.float32)


def save_audio(path: str | Path, x: np.ndarray, sr: int = SR) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fmt = "FLAC" if path.suffix.lower() == ".flac" else "WAV"
    subtype = "PCM_16"
    sf.write(str(path), np.clip(x, -1.0, 1.0), sr, format=fmt, subtype=subtype)


def to_wav_bytes(x: np.ndarray, sr: int = SR) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1.0, 1.0), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_array(x: np.ndarray) -> str:
    q = np.round(np.asarray(x, dtype=np.float64) * 32767).astype(np.int16)
    return hashlib.sha256(q.tobytes()).hexdigest()


def rms_db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-12))
