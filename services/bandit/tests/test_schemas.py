"""Pure Pydantic-model validation — no FastAPI route, no TestClient.

Covers the cross-field ``model_validator`` dimension checks and the field-level
constraints (``min_length``, the ``ArmId`` Literal). Route-level behaviour
(the in-handler finite / range guards) lives in
``test_api.py``.
"""

import pytest
from pydantic import ValidationError

from src.schemas import UpdateRequest


def valid_update_body() -> dict[str, object]:
    return {
        "ridge": 1.0,
        "arm": "EVENING",
        "x": [0.1, 0.2, 0.3],
        "reward": -0.5,
        "state": {"A": [], "b": []},
    }


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
