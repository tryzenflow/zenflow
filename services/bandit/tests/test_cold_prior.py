"""Production LinUCB warm-start prior for cold arms (issue #60, ADR-0001 addendum)."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src import place
from src.api import app
from src.core import constants as consts
from src.core.arms import ARM_BANDS
from src.core.constants import FEATURE_DIM
from src.core.prior import seeded_arm_params, typical_context
from src.models.schemas import ArmParams
from src.schemas import ARM_IDS, ArmId, ArmState
from src.serialization import hydrate, hydrate_arms, is_cold
from src.simulation.prior import (
    WEEKDAY_SHARE,
    PriorSpec,
    band_pref_means,
    typical_contexts,
    warm_state,
)

client = TestClient(app)
EYE = np.eye(FEATURE_DIM)


def _prototype_pref(arm: str, n0: float, ridge: float) -> tuple[np.ndarray, np.ndarray]:
    """The original simulator ``pref`` formula, kept here as the oracle."""
    ctxs = typical_contexts()
    gram = np.sum([w * np.outer(x, x) for w, x in ctxs], axis=0)
    xsum = np.sum([w * x for w, x in ctxs], axis=0)
    return (
        ridge * EYE + n0 * gram,
        n0 * band_pref_means()[arm] * xsum,
    )


@pytest.mark.parametrize("n0", [5.0, 2.5, 12.0])
@pytest.mark.parametrize("ridge", [1.0, 0.7])
def test_matches_the_prototype_pref_mode_to_1e_9(n0: float, ridge: float) -> None:
    assert pytest.approx(5 / 7) == WEEKDAY_SHARE
    a_sim, b_sim = warm_state(PriorSpec("pref", n0), ridge)
    for arm, _, _ in ARM_BANDS:
        want_a, want_b = _prototype_pref(arm, n0, ridge)
        got = seeded_arm_params(arm, ridge, n0)
        np.testing.assert_allclose(got.A, want_a, rtol=0, atol=1e-9)
        np.testing.assert_allclose(got.b, want_b, rtol=0, atol=1e-9)
        # the simulator reuses the production function: one implementation
        np.testing.assert_array_equal(a_sim[arm], got.A)
        np.testing.assert_array_equal(b_sim[arm], got.b)


def test_zero_n0_is_exactly_the_old_cold_start() -> None:
    for arm in ARM_IDS:
        got = seeded_arm_params(arm, 1.3, 0.0)
        np.testing.assert_array_equal(got.A, 1.3 * EYE)
        np.testing.assert_array_equal(got.b, np.zeros(FEATURE_DIM))


def test_hydrate_arms_is_the_old_cold_start_when_the_prior_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(consts, "LINUCB_PRIOR_N0", 0.0)
    arms = hydrate_arms({}, FEATURE_DIM, 1.0)
    for arm in ARM_IDS:
        np.testing.assert_array_equal(arms[arm].A, EYE)
        np.testing.assert_array_equal(arms[arm].b, np.zeros(FEATURE_DIM))


def test_each_arm_gets_n0_total_pseudo_observation_weight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    weights: list[float] = []
    original = ArmParams.add_observation

    def spy(self: ArmParams, x: np.ndarray, payoff: float, weight: float = 1.0) -> None:
        weights.append(weight)
        original(self, x, payoff, weight)

    monkeypatch.setattr(ArmParams, "add_observation", spy)
    n0 = 3.37  # not used elsewhere, so the cache cannot short-circuit the spy
    for arm, lo, hi in ARM_BANDS:
        weights.clear()
        seeded_arm_params(arm, 1.0, n0)
        assert len(weights) == 7 * (hi - lo) // 60  # one per owned (weekday, hour)
        assert sum(weights) == pytest.approx(n0)


def test_add_observation_weight_is_a_scaled_observation() -> None:
    x = np.arange(1.0, FEATURE_DIM + 1)
    plain, weighted, default = (ArmParams.cold(FEATURE_DIM, 1.0) for _ in range(3))
    plain.add_observation(x, 0.5)
    default.add_observation(x, 0.5, 1.0)
    weighted.add_observation(x, 0.5, 0.25)
    np.testing.assert_array_equal(plain.A, default.A)
    np.testing.assert_allclose(weighted.A - EYE, 0.25 * (plain.A - EYE))
    np.testing.assert_allclose(weighted.b, 0.25 * plain.b)


def test_prior_prefers_the_default_matrix_bands_and_is_copy_safe() -> None:
    def theta(arm: str) -> float:
        p = seeded_arm_params(arm, 1.0)
        return float(np.linalg.solve(p.A, p.b) @ typical_context(3))

    order = [theta(a) for a in ("MORNING", "AFTERNOON", "NIGHT", "EARLY_MORNING")]
    assert order == sorted(order, reverse=True)
    first = seeded_arm_params("MORNING", 1.0)
    first.A += 99.0
    first.b += 99.0
    again = seeded_arm_params("MORNING", 1.0)
    assert not np.allclose(again.A, first.A)
    assert not np.allclose(again.b, first.b)


def test_only_cold_arms_get_the_prior() -> None:
    warm_a = (2.0 * EYE).reshape(-1).tolist()
    warm_b = [0.1 * (i + 1) for i in range(FEATURE_DIM)]
    state: dict[ArmId, ArmState] = {"MORNING": ArmState(A=warm_a, b=warm_b)}
    arms = hydrate_arms(state, FEATURE_DIM, 1.0)
    np.testing.assert_array_equal(arms["MORNING"].A, 2.0 * EYE)
    np.testing.assert_array_equal(arms["MORNING"].b, np.asarray(warm_b))
    for arm in ARM_IDS:
        if arm != "MORNING":
            want = seeded_arm_params(arm, 1.0)
            np.testing.assert_array_equal(arms[arm].A, want.A)
            np.testing.assert_array_equal(arms[arm].b, want.b)
    assert not is_cold(state["MORNING"])  # is_cold = "no persisted state", unchanged
    assert is_cold(None) and is_cold(ArmState(A=[], b=[]))


def test_partially_empty_state_does_not_get_the_prior() -> None:
    b_only = ArmState(A=[], b=[0.5] * FEATURE_DIM)
    a, b = hydrate(b_only, FEATURE_DIM, 1.0, "MORNING")
    np.testing.assert_array_equal(a, EYE)
    np.testing.assert_array_equal(b, np.full(FEATURE_DIM, 0.5))
    a_only = ArmState(A=EYE.reshape(-1).tolist(), b=[])
    a, b = hydrate(a_only, FEATURE_DIM, 1.0, "MORNING")
    np.testing.assert_array_equal(b, np.zeros(FEATURE_DIM))


def test_hydrate_without_an_arm_or_other_width_stays_ridge_only() -> None:
    empty = ArmState(A=[], b=[])
    a, b = hydrate(empty, FEATURE_DIM, 1.0)
    np.testing.assert_array_equal(a, EYE)
    np.testing.assert_array_equal(b, np.zeros(FEATURE_DIM))
    a, b = hydrate(empty, 3, 2.0, "MORNING")
    np.testing.assert_array_equal(a, 2.0 * np.eye(3))


def test_update_after_a_cold_arm_keeps_the_prior() -> None:
    x = typical_context(2)
    reward = 1.0
    resp = client.post(
        "/v1/update",
        json={
            "ridge": 1.0,
            "arm": "MORNING",
            "x": x.tolist(),
            "reward": reward,
            "state": {"A": [], "b": []},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    prior = seeded_arm_params("MORNING", 1.0)
    np.testing.assert_allclose(
        np.asarray(body["A"]).reshape(FEATURE_DIM, FEATURE_DIM),
        prior.A + np.outer(x, x),
        atol=1e-12,
    )
    np.testing.assert_allclose(body["b"], prior.b + reward * x, atol=1e-12)
    # the persisted state is warm now: a second update does not re-seed
    again = client.post(
        "/v1/update",
        json={
            "ridge": 1.0,
            "arm": "MORNING",
            "x": x.tolist(),
            "reward": reward,
            "state": body,
        },
    )
    np.testing.assert_allclose(
        np.asarray(again.json()["A"]).reshape(FEATURE_DIM, FEATURE_DIM),
        prior.A + 2 * np.outer(x, x),
        atol=1e-12,
    )


def test_params_version_includes_the_prior_strength(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert place._params_version() == place.PARAMS_VERSION
    monkeypatch.setattr(consts, "LINUCB_PRIOR_N0", 0.0)
    assert place._params_version() != place.PARAMS_VERSION
    monkeypatch.setattr(consts, "LINUCB_PRIOR_N0", 5.0)
    assert place._params_version() == place.PARAMS_VERSION
