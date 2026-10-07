"""Warm-start prior (simulator-only prototype): off = unchanged, on = applied."""

from __future__ import annotations

import numpy as np
import pytest

from src.core import constants as consts
from src.simulation.engine import SimConfig, linucb_label, run_student
from src.simulation.learner import ARMS, LinUCBState
from src.simulation.prior import (
    PRIOR_MODES,
    PriorSpec,
    band_pref_means,
    prior_rewards,
    typical_contexts,
    warm_state,
)

SPEC = PriorSpec("pref", 5.0)


def test_off_is_the_production_cold_start() -> None:
    plain = LinUCBState(0.15, 1.0)
    for off in (None, PriorSpec("pref", 0.0), PriorSpec("flat", 0.0)):
        st = LinUCBState(0.15, 1.0, off)
        for arm in ARMS:
            np.testing.assert_array_equal(st.a[arm], plain.a[arm])
            np.testing.assert_array_equal(st.b[arm], plain.b[arm])
            np.testing.assert_array_equal(st.a[arm], np.eye(consts.FEATURE_DIM))
            np.testing.assert_array_equal(st.b[arm], np.zeros(consts.FEATURE_DIM))
    assert linucb_label(0.15) == linucb_label(0.15, PriorSpec("pref", 0.0))
    assert linucb_label(0.15) == "linucb@0.15"


def test_default_config_runs_no_warm_worlds() -> None:
    assert SimConfig().priors == ()
    res = run_student(SimConfig(seed=3, n_events=8, scenarios=("single",)), 1)
    assert set(res.logs["single"]) == {"heuristic", "linucb@0.15"}


def test_on_applies_the_pseudo_observations() -> None:
    st = LinUCBState(0.15, 1.0, SPEC)
    ctxs = typical_contexts()
    assert sum(w for w, _ in ctxs) == pytest.approx(1.0)
    gram = sum(w * np.outer(x, x) for w, x in ctxs)
    xsum = sum(w * x for w, x in ctxs)
    rewards = prior_rewards("pref")
    for arm in ARMS:
        np.testing.assert_allclose(
            st.a[arm], np.eye(consts.FEATURE_DIM) + SPEC.n0 * gram
        )
        np.testing.assert_allclose(st.b[arm], SPEC.n0 * rewards[arm] * xsum)
    # the prior is the default matrix: morning/afternoon preferred, night owl hours not
    means = band_pref_means()
    assert (
        means["MORNING"] > means["AFTERNOON"] > means["NIGHT"] > means["EARLY_MORNING"]
    )
    x = np.stack([x for _, x in ctxs])
    scores = st.arm_scores(x)
    assert (scores["MORNING"] > scores["EARLY_MORNING"]).all()
    assert (scores["MORNING"] > scores["NIGHT"]).all()


def test_arms_do_not_share_state() -> None:
    st = LinUCBState(0.15, 1.0, SPEC)
    st.observe("MORNING", typical_contexts()[0][1], 1.0)
    fresh = LinUCBState(0.15, 1.0, SPEC)
    np.testing.assert_array_equal(st.a["NIGHT"], fresh.a["NIGHT"])
    np.testing.assert_array_equal(st.b["NIGHT"], fresh.b["NIGHT"])


def test_strength_scales_the_prior_and_flat_has_no_preference() -> None:
    a2, b2 = warm_state(PriorSpec("pref", 2.0), 1.0)
    a4, b4 = warm_state(PriorSpec("pref", 4.0), 1.0)
    eye = np.eye(consts.FEATURE_DIM)
    np.testing.assert_allclose(a4["MORNING"] - eye, 2 * (a2["MORNING"] - eye))
    np.testing.assert_allclose(b4["MORNING"], 2 * b2["MORNING"])
    _, bf = warm_state(PriorSpec("flat", 4.0), 1.0)
    assert all(not v.any() for v in bf.values())
    assert prior_rewards("pref_norm")["MORNING"] == pytest.approx(1.0)
    assert min(prior_rewards("pref_hi").values()) >= 0.5


def test_data_overrides_the_prior() -> None:
    """After enough contradicting rewards the arm's estimate follows the data."""
    st = LinUCBState(0.0, 1.0, SPEC)
    x = typical_contexts()[0][1]
    before = st.arm_scores(x[None, :])["NIGHT"][0]
    for _ in range(200):
        st.observe("NIGHT", x, 1.0)
    after = st.arm_scores(x[None, :])["NIGHT"][0]
    assert before < 0.2 < 0.9 < after


def test_bad_spec_is_rejected() -> None:
    with pytest.raises(ValueError):
        PriorSpec("nope", 1.0)
    with pytest.raises(ValueError):
        PriorSpec("pref", -1.0)
    assert set(PRIOR_MODES) >= {"pref", "flat"}


def test_warm_world_is_deterministic_and_leaves_the_others_alone() -> None:
    base = SimConfig(seed=4, n_events=14, scenarios=("single", "series3-tight"))
    warm = SimConfig(
        seed=4,
        n_events=14,
        scenarios=("single", "series3-tight"),
        priors=(("pref", 5.0),),
    )
    off, a, b = run_student(base, 2), run_student(warm, 2), run_student(warm, 2)
    label = linucb_label(0.15, SPEC)
    for sc in base.scenarios:
        assert label in a.logs[sc]
        for col, arr in a.logs[sc][label].items():
            np.testing.assert_array_equal(arr, b.logs[sc][label][col])
        for pol in ("heuristic", "linucb@0.15"):  # unchanged by adding a warm world
            for col, arr in off.logs[sc][pol].items():
                np.testing.assert_array_equal(arr, a.logs[sc][pol][col])
    starts = a.logs["single"][label]["start"]
    assert not np.array_equal(starts, a.logs["single"]["linucb@0.15"]["start"])
