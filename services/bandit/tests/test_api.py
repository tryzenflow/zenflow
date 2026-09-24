"""End-to-end route behaviour, driven through the FastAPI ``TestClient``.

Pure request-model validation (bad shapes, missing arms, mismatched ``d``) lives
in ``test_schemas.py``; this file exercises the running routes — the in-handler
finite / range guards, update math, and the cold-arm rule.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.models.linucb import score
from src.schemas import ARM_IDS, ArmId, ArmState
from src.serialization import hydrate_arms

client = TestClient(app)

D = 3
ALPHA = 0.15


def cold_state() -> dict[ArmId, dict[str, list[float]]]:
    return {arm: {"A": [], "b": []} for arm in ARM_IDS}


def hydrate(arm: str, x: list[float], reward: float) -> dict[str, list[float]]:
    """Run one /update from the ridge prior and return the arm's new (A, b)."""
    resp = client.post(
        "/v1/update",
        json={
            "ridge": 1.0,
            "arm": arm,
            "x": x,
            "reward": reward,
            "state": {"A": [], "b": []},
        },
    )
    assert resp.status_code == 200
    payload: dict[str, list[float]] = resp.json()
    return payload


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def _scores(
    state: dict[ArmId, dict[str, list[float]]], x: list[float]
) -> dict[ArmId, float]:
    """Score every arm the way /v1/place does: hydrate_arms + linucb.score."""
    arms = hydrate_arms(
        {a: ArmState(**st) for a, st in state.items()}, len(x), ridge=1.0
    )
    xv = np.asarray(x)
    return {a: float(score(p.A, p.b, xv, ALPHA)) for a, p in arms.items()}


def test_cold_arms_score_their_exploration_bonus():
    """Cold arm = ridge prior: θ̂ = 0, score = α·√(xᵀx/λ), equal across arms."""
    x = [0.1, 0.2, 0.3]
    bonus = ALPHA * float(np.sqrt(np.dot(x, x)))
    scores = _scores(cold_state(), x)
    assert set(scores) == set(ARM_IDS)
    assert all(s == pytest.approx(bonus) for s in scores.values())


def test_a_rewarded_arm_ranks_above_a_cold_arm():
    x = [0.5, 0.5, 0.5]
    state = cold_state()
    state["EVENING"] = hydrate("EVENING", x, 1.0)
    scores = _scores(state, x)
    assert scores["EVENING"] > scores["EARLY_MORNING"] == scores["MORNING"]


def test_a_moved_warm_arm_ranks_below_a_cold_arm():
    """Regression: a warm arm whose placement was moved must lose to an
    unexplored arm. With cold arms pinned at 0.0, the warm arm's exploration
    bonus kept it on top and the other arms were never tried."""
    x = [0.5, 0.5, 0.5]
    state = cold_state()
    state["EVENING"] = hydrate("EVENING", x, -0.25)  # a 60-min drag
    scores = _scores(state, x)
    assert scores["EVENING"] < scores["MORNING"] == scores["AFTERNOON"]


def test_update_returns_a_of_length_d_squared_and_b_of_length_d():
    resp = client.post(
        "/v1/update",
        json={
            "ridge": 1.0,
            "arm": "EVENING",
            "x": [1.0, 2.0, 3.0],
            "reward": -0.5,
            "state": {"A": [], "b": []},
        },
    )
    assert resp.status_code == 200

    body = resp.json()
    assert len(body["A"]) == D * D
    assert len(body["b"]) == D


def test_update_math_matches_the_model_core():
    x = [1.0, 2.0, 3.0]
    reward = 0.75
    body = hydrate("MORNING", x, reward)

    xv = np.asarray(x)
    np.testing.assert_allclose(
        np.asarray(body["A"]).reshape(D, D), np.identity(D) + np.outer(xv, xv)
    )
    np.testing.assert_allclose(np.asarray(body["b"]), reward * xv)


def test_update_accepts_previously_hydrated_state():
    x = [0.4, 0.5, 0.6]
    first = hydrate("NIGHT", x, 1.0)
    resp = client.post(
        "/v1/update",
        json={
            "ridge": 1.0,
            "arm": "NIGHT",
            "x": x,
            "reward": 1.0,
            "state": first,
        },
    )
    assert resp.status_code == 200

    body = resp.json()
    xv = np.asarray(x)
    expected_a = np.identity(D) + 2.0 * np.outer(xv, xv)
    np.testing.assert_allclose(np.asarray(body["A"]).reshape(D, D), expected_a)
    np.testing.assert_allclose(np.asarray(body["b"]), 2.0 * xv)


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(
            {
                "ridge": 0.0,
                "arm": "MORNING",
                "x": [0.1, 0.2, 0.3],
                "reward": 1.0,
                "state": {"A": [], "b": []},
            },
            id="non-positive-ridge-handler-guard",
        ),
        pytest.param(
            {
                "ridge": 1.0,
                "arm": "LATE_NIGHT",
                "x": [0.1, 0.2, 0.3],
                "reward": 1.0,
                "state": {"A": [], "b": []},
            },
            id="bad-arm-surfaces-as-422-not-500",
        ),
    ],
)
def test_update_route_rejects_malformed_bodies(body):
    assert client.post("/v1/update", json=body).status_code == 422


def test_update_rejects_a_non_finite_reward():
    raw = (
        '{"ridge": 1.0, "arm": "MORNING", "x": [0.1, 0.2, 0.3],'
        '"reward": 1e400, "state": {"A": [], "b": []}}'
    )
    resp = client.post(
        "/v1/update", content=raw, headers={"content-type": "application/json"}
    )
    assert resp.status_code == 422
