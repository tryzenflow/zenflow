"""Pure Pydantic-model validation — no FastAPI route, no TestClient.

Covers the cross-field ``model_validator`` dimension checks and the field-level
constraints (``min_length``, the ``ArmId`` Literal). Route-level behaviour
(the in-handler finite / range guards, update-then-predict) lives in
``test_api.py``.
"""

import pytest
from pydantic import ValidationError

from src.schemas import ARM_IDS, PredictRequest, UpdateRequest


def cold_state() -> dict[str, dict[str, list[float]]]:
    return {arm: {"A": [], "b": []} for arm in ARM_IDS}


def valid_predict_body() -> dict[str, object]:
    return {
        "alpha": 0.15,
        "ridge": 1.0,
        "state": cold_state(),
        "contexts": [{"day": "2026-09-01", "x": [0.1, 0.2, 0.3]}],
    }


def valid_update_body() -> dict[str, object]:
    return {
        "ridge": 1.0,
        "arm": "EVENING",
        "x": [0.1, 0.2, 0.3],
        "reward": -0.5,
        "state": {"A": [], "b": []},
    }


class TestPredictRequest:
    def test_accepts_a_well_formed_body(self):
        req = PredictRequest.model_validate(valid_predict_body())
        assert set(req.state) == set(ARM_IDS)
        assert req.contexts[0].day == "2026-09-01"
        assert req.contexts[0].x == [0.1, 0.2, 0.3]

    def test_infers_and_accepts_a_hydrated_arm_of_the_right_width(self):
        body = valid_predict_body()
        body["state"] = {**cold_state(), "MORNING": {"A": [1.0] * 9, "b": [0.0] * 3}}
        req = PredictRequest.model_validate(body)
        assert len(req.state["MORNING"].A) == 9

    @pytest.mark.parametrize(
        "body",
        [
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
                id="contexts-disagree-on-d",
            ),
            pytest.param(
                {
                    "alpha": 0.15,
                    "ridge": 1.0,
                    "state": {
                        **cold_state(),
                        "MORNING": {"A": [1.0, 2.0, 3.0], "b": []},
                    },
                    "contexts": [{"day": "a", "x": [0.1, 0.2, 0.3]}],
                },
                id="A-not-d-squared",
            ),
            pytest.param(
                {
                    "alpha": 0.15,
                    "ridge": 1.0,
                    "state": {**cold_state(), "MORNING": {"A": [], "b": [1.0, 2.0]}},
                    "contexts": [{"day": "a", "x": [0.1, 0.2, 0.3]}],
                },
                id="b-not-length-d",
            ),
            pytest.param(
                {
                    "alpha": 0.15,
                    "ridge": 1.0,
                    "state": {"MORNING": {"A": [], "b": []}},
                    "contexts": [{"day": "a", "x": [0.1, 0.2, 0.3]}],
                },
                id="missing-arm",
            ),
            pytest.param(
                {
                    "alpha": 0.15,
                    "ridge": 1.0,
                    "state": {**cold_state(), "LATE_NIGHT": {"A": [], "b": []}},
                    "contexts": [{"day": "a", "x": [0.1, 0.2, 0.3]}],
                },
                id="unknown-arm-key",
            ),
            pytest.param(
                {"alpha": 0.15, "ridge": 1.0, "state": cold_state(), "contexts": []},
                id="empty-contexts",
            ),
            pytest.param(
                {
                    "alpha": 0.15,
                    "ridge": 1.0,
                    "state": cold_state(),
                    "contexts": [{"day": "a", "x": []}],
                },
                id="empty-context-x",
            ),
        ],
    )
    def test_rejects_malformed_bodies(self, body):
        with pytest.raises(ValidationError):
            PredictRequest.model_validate(body)


class TestUpdateRequest:
    def test_accepts_a_well_formed_body(self):
        req = UpdateRequest.model_validate(valid_update_body())
        assert req.arm == "EVENING"
        assert req.state.A == []

    def test_accepts_a_hydrated_state_of_the_right_width(self):
        body = valid_update_body()
        body["state"] = {"A": [1.0] * 9, "b": [0.0] * 3}
        req = UpdateRequest.model_validate(body)
        assert len(req.state.A) == 9

    @pytest.mark.parametrize(
        "body",
        [
            pytest.param(
                {
                    "ridge": 1.0,
                    "arm": "LATE_NIGHT",
                    "x": [0.1, 0.2, 0.3],
                    "reward": 1.0,
                    "state": {"A": [], "b": []},
                },
                id="arm-not-canonical",
            ),
            pytest.param(
                {
                    "ridge": 1.0,
                    "arm": "MORNING",
                    "x": [],
                    "reward": 1.0,
                    "state": {"A": [], "b": []},
                },
                id="empty-x",
            ),
            pytest.param(
                {
                    "ridge": 1.0,
                    "arm": "MORNING",
                    "x": [0.1, 0.2, 0.3],
                    "reward": 1.0,
                    "state": {"A": [1.0, 2.0], "b": []},
                },
                id="A-not-d-squared",
            ),
            pytest.param(
                {
                    "ridge": 1.0,
                    "arm": "MORNING",
                    "x": [0.1, 0.2, 0.3],
                    "reward": 1.0,
                    "state": {"A": [], "b": [1.0]},
                },
                id="b-not-length-d",
            ),
        ],
    )
    def test_rejects_malformed_bodies(self, body):
        with pytest.raises(ValidationError):
            UpdateRequest.model_validate(body)
