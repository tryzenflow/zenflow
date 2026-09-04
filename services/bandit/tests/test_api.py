"""End-to-end route behaviour, driven through the FastAPI ``TestClient``.

Pure request-model validation (bad shapes, missing arms, mismatched ``d``) lives
in ``test_schemas.py``; this file exercises the running routes — the in-handler
finite / range guards, the cold-arm rule, and update-then-predict.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.schemas import ARM_IDS

client = TestClient(app)

D = 3


def cold_state() -> dict[str, dict[str, list[float]]]:
    return {arm: {"A": [], "b": []} for arm in ARM_IDS}


def hydrate(arm: str, x: list[float], reward: float) -> dict[str, list[float]]:
    """Run one /update from the ridge prior and return the arm's new (A, b)."""
    resp = client.post(
        "/update",
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


def test_predict_all_cold_returns_five_arms_all_zero():
    body = {
        "alpha": 0.15,
        "ridge": 1.0,
        "state": cold_state(),
        "contexts": [
            {"day": "2026-09-01", "x": [0.1, 0.2, 0.3]},
            {"day": "2026-09-02", "x": [0.4, 0.5, 0.6]},
            {"day": "2026-09-03", "x": [-0.9, 0.0, 0.7]},
        ],
    }
    resp = client.post("/predict", json=body)
    assert resp.status_code == 200

    scores = resp.json()["scores"]
    assert set(scores) == {"2026-09-01", "2026-09-02", "2026-09-03"}
    for day in scores.values():
        assert set(day) == set(ARM_IDS)
        assert all(value == 0.0 for value in day.values())


def test_predict_hydrated_arm_scores_nonzero_others_stay_zero():
    x = [1.0, 0.0, 0.0]
    state = cold_state()
    state["EVENING"] = hydrate("EVENING", x, 1.0)

    resp = client.post(
        "/predict",
        json={
            "alpha": 0.15,
            "ridge": 1.0,
            "state": state,
            "contexts": [{"day": "2026-09-01", "x": x}],
        },
    )
    assert resp.status_code == 200

    day = resp.json()["scores"]["2026-09-01"]
    assert day["EVENING"] != 0.0
    assert day["MORNING"] == 0.0
    assert day["EARLY_MORNING"] == 0.0


def test_update_returns_a_of_length_d_squared_and_b_of_length_d():
    resp = client.post(
        "/update",
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
        "/update",
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


def test_update_then_predict_ranks_the_rewarded_arm_above_a_cold_arm():
    x = [0.5, 0.5, 0.5]
    state = cold_state()
    state["EVENING"] = hydrate("EVENING", x, 1.0)

    resp = client.post(
        "/predict",
        json={
            "alpha": 0.15,
            "ridge": 1.0,
            "state": state,
            "contexts": [{"day": "2026-09-01", "x": x}],
        },
    )
    assert resp.status_code == 200

    day = resp.json()["scores"]["2026-09-01"]
    assert day["EARLY_MORNING"] == 0.0
    assert day["EVENING"] > day["EARLY_MORNING"]


def test_predict_infers_d_from_a_larger_context():
    d = 5
    x = [0.2] * d
    state = cold_state()
    state["MORNING"] = hydrate("MORNING", x, 1.0)

    resp = client.post(
        "/predict",
        json={
            "alpha": 0.1,
            "ridge": 1.0,
            "state": state,
            "contexts": [{"day": "2026-09-01", "x": x}],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["scores"]["2026-09-01"]["MORNING"] != 0.0


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(
            {
                "alpha": -0.1,
                "ridge": 1.0,
                "state": cold_state(),
                "contexts": [{"day": "a", "x": [0.1, 0.2, 0.3]}],
            },
            id="negative-alpha-handler-guard",
        ),
        pytest.param(
            {
                "alpha": 0.15,
                "ridge": 0.0,
                "state": cold_state(),
                "contexts": [{"day": "a", "x": [0.1, 0.2, 0.3]}],
            },
            id="non-positive-ridge-handler-guard",
        ),
        pytest.param(
            {
                "alpha": 0.15,
                "ridge": 1.0,
                "state": cold_state(),
                "contexts": [
                    {"day": "a", "x": [0.1, 0.2, 0.3]},
                    {"day": "b", "x": [0.1, 0.2]},
                ],
            },
            id="bad-shape-surfaces-as-422-not-500",
        ),
    ],
)
def test_predict_route_rejects_malformed_bodies(body):
    assert client.post("/predict", json=body).status_code == 422


def test_predict_rejects_a_non_finite_context_value():
    # sent as raw content: json.dumps refuses to emit inf, but 1e400 is a
    # syntactically valid JSON number that parses to inf server-side.
    raw = (
        '{"alpha": 0.15, "ridge": 1.0,'
        '"state": {"EARLY_MORNING": {"A": [], "b": []},'
        '"MORNING": {"A": [], "b": []}, "AFTERNOON": {"A": [], "b": []},'
        '"EVENING": {"A": [], "b": []}, "NIGHT": {"A": [], "b": []}},'
        '"contexts": [{"day": "a", "x": [0.1, 1e400, 0.3]}]}'
    )
    resp = client.post(
        "/predict", content=raw, headers={"content-type": "application/json"}
    )
    assert resp.status_code == 422


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
    assert client.post("/update", json=body).status_code == 422


def test_update_rejects_a_non_finite_reward():
    raw = (
        '{"ridge": 1.0, "arm": "MORNING", "x": [0.1, 0.2, 0.3],'
        '"reward": 1e400, "state": {"A": [], "b": []}}'
    )
    resp = client.post(
        "/update", content=raw, headers={"content-type": "application/json"}
    )
    assert resp.status_code == 422
