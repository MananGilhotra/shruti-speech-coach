import pytest

from shruti.config import load_config
from shruti.detect.core import Region
from shruti.eval.match import iou, match
from shruti.rubric.score import score


def test_iou():
    assert iou((0, 1), (0, 1)) == 1
    assert iou((0, 1), (2, 3)) == 0
    assert iou((0, 2), (1, 3)) == pytest.approx(1 / 3)


def test_match_is_one_to_one_and_typed():
    labels = [{"type": "filler", "t_start": 1.0, "t_end": 1.5}, {"type": "rushed", "t_start": 3.0, "t_end": 5.0}]
    preds = [{"type": "filler", "t_start": 1.02, "t_end": 1.48}, {"type": "filler", "t_start": 1.0, "t_end": 1.4},
             {"type": "dragged", "t_start": 3.0, "t_end": 5.0}]
    m, fps, fns = match(labels, preds, 0.5)
    assert len(m) == 1 and m[0][0]["type"] == "filler"
    assert len(fps) == 2                     # duplicate filler + wrong type
    assert len(fns) == 1 and fns[0]["type"] == "rushed"


def _region(ftype, sev):
    return Region(ftype=ftype, i=0, j=1, t_start=0, t_end=1, z=4, p=1e-4, q=1e-3, severity=sev, tests=[])


def test_rubric_cost_per_minute():
    cfg = load_config()
    out = score([_region("filler", 3), _region("filler", 3)], 60.0, {"tempo_factor": 1.0}, cfg)
    # two severity-3 flaws in one minute cost 2 x 1.0 point
    assert out["dimensions"]["fluency"]["score"] == pytest.approx(8.0)
    assert out["dimensions"]["pacing"]["score"] == 10.0
    assert 24 <= out["wsdc_style"] <= 32


def test_rubric_style_penalty_only_when_far_off():
    cfg = load_config()
    assert score([], 60, {"tempo_factor": 1.05}, cfg)["dimensions"]["pacing"]["style_penalty"] == 0
    assert score([], 60, {"tempo_factor": 1.6}, cfg)["dimensions"]["pacing"]["style_penalty"] > 0
