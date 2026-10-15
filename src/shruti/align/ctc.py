"""Forced alignment with wav2vec2 CTC emissions and an exact CTC Viterbi pass.

We implement the Viterbi recursion ourselves (blank states, no repeated-label skips)
so the aligner does not depend on torchaudio APIs that change between releases.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np

from shruti.text.words import Token

FRAME_S = 0.02  # wav2vec2 conv stride = 320 samples at 16 kHz
NEG = -1e30


@dataclass
class AlignedWord:
    index: int
    text: str
    start: float
    end: float
    score: float          # mean log-probability of the word's characters
    char_times: tuple = ()  # time of the first frame of each character emission


def ctc_viterbi(log_probs: np.ndarray, targets: np.ndarray, blank: int = 0) -> np.ndarray:
    """Best CTC path. Returns, for every frame, the index into `targets` it emits, or -1 for blank."""
    T = log_probs.shape[0]
    L = len(targets)
    S = 2 * L + 1
    if T < L:
        raise ValueError(f"audio too short to align: {T} frames for {L} labels")
    ext = np.full(S, blank, dtype=np.int64)
    ext[1::2] = targets
    skip_ok = np.zeros(S, dtype=bool)
    skip_ok[2:] = (ext[2:] != blank) & (ext[2:] != ext[:-2])

    dp = np.full(S, NEG, dtype=np.float64)
    dp[0] = log_probs[0, blank]
    if S > 1:
        dp[1] = log_probs[0, ext[1]]
    back = np.zeros((T, S), dtype=np.int8)
    neg1 = np.array([NEG])
    neg2 = np.array([NEG, NEG])
    for t in range(1, T):
        prev1 = np.concatenate([neg1, dp[:-1]])
        prev2 = np.concatenate([neg2, dp[:-2]])
        prev2[~skip_ok] = NEG
        cand = np.stack([dp, prev1, prev2])
        arg = cand.argmax(axis=0)
        dp = cand[arg, np.arange(S)] + log_probs[t, ext]
        back[t] = arg
    s = S - 1 if S == 1 or dp[S - 1] >= dp[S - 2] else S - 2
    states = np.empty(T, dtype=np.int64)
    for t in range(T - 1, -1, -1):
        states[t] = s
        s -= int(back[t, s])
    return np.where(states % 2 == 1, (states - 1) // 2, -1)


class Aligner:
    """Lazily loaded, shared wav2vec2 model."""

    _instances: dict = {}
    _lock = threading.Lock()

    @classmethod
    def get(cls, model_name: str = "facebook/wav2vec2-base-960h", device: str = "cpu") -> "Aligner":
        key = (model_name, device)
        with cls._lock:
            if key not in cls._instances:
                cls._instances[key] = cls(model_name, device)
            return cls._instances[key]

    def __init__(self, model_name: str, device: str = "cpu") -> None:
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        from transformers.utils import logging as hf_logging

        hf_logging.set_verbosity_error()
        torch.manual_seed(0)
        self.torch = torch
        self.device = device
        self.model = Wav2Vec2ForCTC.from_pretrained(model_name).eval().to(device)
        self.processor = Wav2Vec2Processor.from_pretrained(model_name)
        self.vocab: dict[str, int] = self.processor.tokenizer.get_vocab()
        self.inv = {v: k for k, v in self.vocab.items()}
        self.blank = self.vocab.get("<pad>", 0)
        self.delim = self.vocab.get("|", 4)
        self._run_lock = threading.Lock()

    # ------------------------------------------------------------------ emissions
    def _logits(self, x: np.ndarray) -> np.ndarray:
        torch = self.torch
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)
        with self._run_lock, torch.inference_mode():
            inp = torch.from_numpy(x.astype(np.float32))[None].to(self.device)
            logits = self.model(inp).logits[0]
            return torch.log_softmax(logits.float(), dim=-1).cpu().numpy()

    def emissions(self, audio: np.ndarray, sr: int = 16000, chunk_s: float = 30.0,
                  context_s: float = 1.0) -> np.ndarray:
        """Frame-level log-probabilities [T, V]; long audio is processed in overlapping chunks."""
        n = len(audio)
        hop = int(FRAME_S * sr)
        total_frames = max(1, n // hop)
        chunk = int(chunk_s * sr)
        if n <= chunk + 2 * int(context_s * sr):
            lp = self._logits(audio)
            return lp[:total_frames] if len(lp) >= total_frames else lp
        ctx = int(context_s * sr)
        out = []
        for s in range(0, n, chunk):
            a, b = max(0, s - ctx), min(n, s + chunk + ctx)
            lp = self._logits(audio[a:b])
            f0 = (s - a) // hop
            f1 = f0 + (min(s + chunk, n) - s) // hop
            out.append(lp[f0:f1])
        return np.concatenate(out, axis=0)

    # ------------------------------------------------------------------ alignment
    def align(self, audio: np.ndarray, tokens: list[Token], log_probs: np.ndarray | None = None
              ) -> list[AlignedWord]:
        if log_probs is None:
            log_probs = self.emissions(audio)
        targets: list[int] = []
        owner: list[int] = []
        for i, tok in enumerate(tokens):
            if i > 0:
                targets.append(self.delim)
                owner.append(-1)
            for ch in tok.chars:
                targets.append(self.vocab.get(ch, self.vocab.get("<unk>", 3)))
                owner.append(i)
        tgt = np.asarray(targets, dtype=np.int64)
        path = ctc_viterbi(log_probs, tgt, blank=self.blank)
        owner_arr = np.asarray(owner, dtype=np.int64)
        frame_owner = np.where(path >= 0, owner_arr[np.clip(path, 0, None)], -1)
        words: list[AlignedWord] = []
        for i, tok in enumerate(tokens):
            idx = np.flatnonzero(frame_owner == i)
            if len(idx) == 0:  # should not happen with a valid path; keep a zero-length marker
                t = words[-1].end if words else 0.0
                words.append(AlignedWord(i, tok.display, t, t, float("-inf")))
                continue
            sc = log_probs[idx, tgt[path[idx]]]
            first = idx[np.concatenate([[True], path[idx][1:] != path[idx][:-1]])]
            words.append(AlignedWord(i, tok.display, idx[0] * FRAME_S, (idx[-1] + 1) * FRAME_S, float(sc.mean()),
                                     tuple(float(f * FRAME_S) for f in first)))
        return words

    # ------------------------------------------------------------------ greedy transcript
    def transcribe(self, audio: np.ndarray, log_probs: np.ndarray | None = None
                   ) -> list[tuple[str, float, float]]:
        """Greedy CTC decode into (word, start_s, end_s) triples."""
        if log_probs is None:
            log_probs = self.emissions(audio)
        best = log_probs.argmax(axis=1)
        words: list[tuple[str, float, float]] = []
        cur, start, last_t, prev = "", None, None, None
        for t, k in enumerate(best):
            k = int(k)
            if k == prev:
                if k not in (self.blank, self.delim):
                    last_t = t
                continue
            prev = k
            if k == self.blank:
                continue
            if k == self.delim:
                if cur:
                    words.append((cur.lower(), start * FRAME_S, (last_t + 1) * FRAME_S))
                cur, start = "", None
                continue
            ch = self.inv.get(k, "")
            if len(ch) == 1:
                if not cur:
                    start = t
                cur += ch
                last_t = t
        if cur:
            words.append((cur.lower(), start * FRAME_S, (last_t + 1) * FRAME_S))
        return words
