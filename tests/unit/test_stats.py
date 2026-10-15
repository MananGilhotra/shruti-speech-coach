import numpy as np
import pytest
from statsmodels.stats.multitest import multipletests

from shruti.detect.core import benjamini_hochberg, severity_from_z, window_sd


@pytest.mark.parametrize("seed", range(5))
def test_bh_matches_statsmodels(seed):
    rng = np.random.default_rng(seed)
    p = np.concatenate([rng.uniform(size=400), rng.uniform(0, 1e-4, size=12)])
    rng.shuffle(p)
    reject, q = benjamini_hochberg(p, 0.05)
    ref_reject, ref_q, _, _ = multipletests(p, alpha=0.05, method="fdr_bh")
    assert (reject == ref_reject).all()
    assert np.allclose(q, ref_q)


def test_bh_empty_and_all_null():
    r, q = benjamini_hochberg(np.array([]), 0.05)
    assert len(r) == 0
    r, q = benjamini_hochberg(np.full(100, 0.9), 0.05)
    assert not r.any()


def test_window_sd_independent_and_correlated():
    s = np.full(4, 0.2)
    assert window_sd(s, 0.0) == pytest.approx(0.2 / 2)       # sd / sqrt(k)
    assert window_sd(s, 1.0) == pytest.approx(0.2)           # perfectly correlated: no averaging gain


def test_severity_bands():
    bands = [2.5, 3.5, 5.0, 7.0, 10.0]
    assert severity_from_z(2.6, bands) == 1
    assert severity_from_z(-6.0, bands) == 3
    assert severity_from_z(50, bands) == 5
