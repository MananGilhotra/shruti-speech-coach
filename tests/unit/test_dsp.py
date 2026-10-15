import numpy as np
import pytest

from shruti import dsp


def _tone(sec=2.0, sr=16000):
    t = np.arange(int(sec * sr)) / sr
    return (0.3 * np.sin(2 * np.pi * (150 * t + 2 * np.sin(2 * np.pi * 3 * t)))).astype(np.float32)


def test_timemap_insertion_and_deletion_compose():
    tm = dsp.TimeMap.insertion(1.0, 0.5).then(dsp.TimeMap.deletion(2.0, 2.2))
    assert tm(0.5) == pytest.approx(0.5)
    assert tm(1.0) == pytest.approx(1.5)          # material at the insertion point moves right
    assert tm(1.6) == pytest.approx(2.0)          # 1.6 -> 2.1 lands inside the deleted span -> 2.0
    assert tm(3.0) == pytest.approx(3.3)          # +0.5 inserted, -0.2 deleted


def test_psola_duration_map_matches_output_length():
    x = _tone(3.0)
    pts = [(0.5, 1.0), (0.6, 1.8), (1.5, 1.8), (1.6, 1.0)]
    y, tm = dsp.psola(x, 75, 500, pts)
    assert len(y) / 16000 == pytest.approx(float(tm(3.0)), abs=0.01)


def test_identity_psola_keeps_length_and_level():
    x = _tone(1.5)
    y, _ = dsp.psola(x, 75, 500)
    # overlap-add resynthesis shifts phase, so compare duration and level rather than samples
    assert abs(len(y) - len(x)) <= 160
    ratio = np.sqrt(np.mean(y ** 2)) / np.sqrt(np.mean(x ** 2))
    assert 0.8 < ratio < 1.25


def test_room_tone_length_and_level():
    rng = np.random.default_rng(0)
    x = np.concatenate([np.zeros(8000), _tone(1.0), 0.001 * rng.standard_normal(8000)]).astype(np.float32)
    silent = np.zeros(len(x) // 160, bool)
    silent[:45] = True
    silent[-45:] = True
    rt = dsp.room_tone(x, silent, 0.01, 0.7, rng)
    assert len(rt) == int(0.7 * 16000)
    assert np.max(np.abs(rt)) < 0.05
