"""Simulator statistics and metrics against known small cases."""

from __future__ import annotations

import math

import numpy as np
import pytest

from src.simulation.engine import HEURISTIC, SimConfig, StudentResult
from src.simulation.metrics import (
    BUCKET_LABELS,
    aggregate,
    bucket_index,
    build_report,
    cliffs_delta,
    cluster_bootstrap_ratio,
    paired_rows,
    time_to_threshold,
    wilcoxon_signed_rank,
)

# ---- Wilcoxon -------------------------------------------------------------


def test_wilcoxon_all_positive_matches_hand_calculation() -> None:
    w, n, z, p = wilcoxon_signed_rank(np.array([1.0, 2.0, 3.0, 4.0, 5.0]))
    assert (w, n) == (15.0, 5)
    # mean 7.5, var 5*6*11/24 = 13.75, continuity-corrected z = 7 / sqrt(13.75)
    assert z == pytest.approx(7 / math.sqrt(13.75))
    assert p == pytest.approx(math.erfc(z / math.sqrt(2)))
    assert 0.058 < p < 0.060


def test_wilcoxon_symmetric_deltas_are_not_significant_and_zeros_drop() -> None:
    w, n, z, p = wilcoxon_signed_rank(np.array([-2.0, -1.0, 1.0, 2.0, 0.0, 0.0]))
    assert n == 4 and w == 5.0 and z == 0.0 and p == 1.0


def test_wilcoxon_uses_average_ranks_for_ties() -> None:
    # |d| = 1,1,1,3 -> ranks 2,2,2,4 ; positives are the three ones and nothing else
    w, n, _, _ = wilcoxon_signed_rank(np.array([1.0, -1.0, 1.0, 3.0]))
    assert n == 4 and w == 2 + 2 + 4


def test_wilcoxon_sign_follows_direction_and_empty_is_neutral() -> None:
    _, _, z_pos, _ = wilcoxon_signed_rank(np.arange(1.0, 11.0))
    _, _, z_neg, _ = wilcoxon_signed_rank(-np.arange(1.0, 11.0))
    assert z_pos > 0 > z_neg and z_pos == pytest.approx(-z_neg)
    assert wilcoxon_signed_rank(np.zeros(3)) == (0.0, 0, 0.0, 1.0)


# ---- Cliff's delta ----------------------------------------------------------


def test_cliffs_delta_known_cases() -> None:
    assert cliffs_delta(np.array([3.0, 4.0]), np.array([1.0, 2.0])) == 1.0
    assert cliffs_delta(np.array([1.0, 2.0]), np.array([3.0, 4.0])) == -1.0
    assert cliffs_delta(np.array([1.0, 2.0, 3.0]), np.array([2.0])) == 0.0
    # pairs: (1,2) lt, (3,2) gt, (3,4) lt, (3,1) gt, (1,1) tie, (1,4) lt ... by hand
    a, b = np.array([1.0, 3.0]), np.array([1.0, 2.0, 4.0])
    assert cliffs_delta(a, b) == pytest.approx((2 - 3) / 6)


# ---- bootstrap ------------------------------------------------------------------


def test_bootstrap_collapses_for_identical_clusters_and_is_reproducible() -> None:
    num, den = np.full(12, 3.0), np.full(12, 10.0)
    lo, hi = cluster_bootstrap_ratio(num, den, np.random.default_rng(0))
    assert lo == pytest.approx(0.3) and hi == pytest.approx(0.3)
    rng_a, rng_b = np.random.default_rng(5), np.random.default_rng(5)
    x = np.linspace(0, 9, 10)
    assert cluster_bootstrap_ratio(x, np.ones(10), rng_a) == cluster_bootstrap_ratio(
        x, np.ones(10), rng_b
    )


def test_bootstrap_brackets_the_estimate_and_narrows_with_more_clusters() -> None:
    rng = np.random.default_rng(1)
    small = rng.normal(1.0, 1.0, 10)
    large = rng.normal(1.0, 1.0, 400)
    lo_s, hi_s = cluster_bootstrap_ratio(small, np.ones(10), np.random.default_rng(2))
    lo_l, hi_l = cluster_bootstrap_ratio(large, np.ones(400), np.random.default_rng(2))
    assert lo_s < small.mean() < hi_s and lo_l < large.mean() < hi_l
    assert hi_l - lo_l < hi_s - lo_s


# ---- buckets / time to threshold ---------------------------------------------------


def test_cold_start_buckets_follow_the_ab_doc() -> None:
    obs = np.array([0, 5, 6, 10, 11, 20, 21, 40, 41, 500], dtype=np.float64)
    assert bucket_index(obs).tolist() == [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]
    assert BUCKET_LABELS == ("0-5", "6-10", "11-20", "21-40", "40+")


def test_time_to_threshold_and_censoring() -> None:
    assert time_to_threshold(np.ones(30)) == (10, True)
    assert time_to_threshold(np.zeros(25)) == (25, False)
    late = np.concatenate([np.zeros(10), np.ones(10)])
    t, hit = time_to_threshold(late)
    assert hit and t == 16  # 6 ones in the window of placements 7-16
    assert time_to_threshold(np.ones(4)) == (4, False)  # too short for one window


# ---- aggregate on synthetic worlds ---------------------------------


def _log(
    n: int, regret: float, accept: float, start_shift: int = 0
) -> dict[str, np.ndarray]:
    ids = np.arange(n, dtype=np.float64)
    return {
        "task_id": ids,
        "member": np.zeros(n),
        "obs_before": ids,
        "regret": np.full(n, regret),
        "accepted": np.full(n, accept),
        "drag": np.full(n, (1 - accept) * 100.0),
        "start": ids * 3_600_000 + start_shift,
        "used_linucb": np.ones(n),
    }


def _results(n_students: int = 8, n: int = 50) -> list[StudentResult]:
    out = []
    for sid in range(n_students):
        out.append(
            StudentResult(
                sid,
                "early_bird",
                "stable" if sid % 2 else "crammer",
                {
                    "single": {
                        HEURISTIC: _log(n, 0.6 + 0.01 * sid, 0.5),
                        "linucb@0.15": _log(n, 0.3 + 0.01 * sid, 0.8, 900_000),
                    }
                },
            )
        )
    return out


def test_aggregate_recovers_the_planted_effect() -> None:
    rows = paired_rows(_results(), ("single",), "linucb@0.15")
    a = aggregate(rows, seed=1, tag="t")
    assert a["n_students"] == 8 and a["n_placements"] == 400
    regret = a["regret"]
    assert isinstance(regret, dict)
    assert regret["diff"] == pytest.approx(-0.3)
    assert regret["ci95"][0] <= -0.3 <= regret["ci95"][1]
    assert regret["wilcoxon_p"] < 0.05 and regret["cliffs_delta"] == -1.0
    accept = a["accept"]
    assert isinstance(accept, dict) and accept["diff"] == pytest.approx(0.3)
    div = a["divergence"]
    assert isinstance(div, dict) and div["rate"] == 1.0
    assert div["mean_start_gap_min"] == pytest.approx(15.0)


def test_aggregate_slices_by_bucket_and_cell() -> None:
    rows = paired_rows(_results(), ("single",), "linucb@0.15")
    first = aggregate(rows, 1, "b0", bucket=0)
    assert first["n_placements"] == 8 * 6  # obs 0..5
    top = aggregate(rows, 1, "b4", bucket=4)
    assert top["n_placements"] == 8 * 9  # obs 41..49
    stable = aggregate(rows, 1, "c", cell="early_bird/stable")
    assert stable["n_students"] == 4
    assert aggregate(rows, 1, "none", cell="night_owl/planner") == {
        "n_students": 0,
        "n_placements": 0,
    }


def test_build_report_has_everything_the_issue_asks_for() -> None:
    cfg = SimConfig(
        n_students=8, n_events=50, scenarios=("single",), alphas=(0.15, 0.3)
    )
    res = _results()
    for r in res:  # the sweep needs a log per alpha
        r.logs["single"]["linucb@0.3"] = r.logs["single"]["linucb@0.15"]
    rep = build_report(cfg, res, n_boot=200)
    for key in ("overall", "by_scenario", "by_bucket", "by_cell", "time_to_threshold"):
        assert key in rep
    assert set(rep["by_bucket"]) == set(BUCKET_LABELS)  # type: ignore[call-overload]
    assert len(rep["alpha_sweep"]) == 2  # type: ignore[arg-type]
    assert "ci95" in rep["overall"]["regret"]  # type: ignore[index]
