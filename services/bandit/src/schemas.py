"""Wire contract for the bandit HTTP surface — Pydantic request/response models.

Field names must match the NestJS backend exactly (ADR-0001 §6.1). ``d`` (the
context dimension, 46 in production) is **inferred** from the length of ``x`` and
validated by the cross-field ``model_validator``s here — never hardcoded.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

#: Canonical time-of-day arms (``SchedulingArm`` in ``@zenflow/shared``),
#: half-open and lower-inclusive: 00-06 / 06-11 / 11-17 / 17-20 / 20-24.
ArmId = Literal["EARLY_MORNING", "MORNING", "AFTERNOON", "EVENING", "NIGHT"]

ARM_IDS: tuple[ArmId, ...] = (
    "EARLY_MORNING",
    "MORNING",
    "AFTERNOON",
    "EVENING",
    "NIGHT",
)


class ArmState(BaseModel):
    """Per-arm ridge-regression state.

    ``A`` is ``d*d`` floats row-major; ``b`` is ``d`` floats. Either list may be
    empty, meaning "no data yet": the arm falls back to the cold ridge prior
    (``A = ridge·I``, ``b = 0``). A fully-empty state scores ``0.0`` in
    ``/predict`` by contract — the exploration bonus is withheld until the arm
    has real observations, which is what keeps a fresh model stable.
    """

    A: list[float] = Field(default_factory=list)
    b: list[float] = Field(default_factory=list)


class Context(BaseModel):
    """Context vector ``x`` for one candidate ``day`` (an opaque key echoed back)."""

    day: str
    x: list[float] = Field(min_length=1)


class PredictRequest(BaseModel):
    alpha: float
    ridge: float
    state: dict[ArmId, ArmState]
    contexts: list[Context] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_dims(self) -> PredictRequest:
        missing = [arm for arm in ARM_IDS if arm not in self.state]
        if missing:
            raise ValueError(f"state is missing arms: {missing}")

        lengths = {len(ctx.x) for ctx in self.contexts}
        if len(lengths) > 1:
            raise ValueError(
                f"every context x must share one length d, got {sorted(lengths)}"
            )
        d = lengths.pop()

        for arm, st in self.state.items():
            if st.A and len(st.A) != d * d:
                raise ValueError(
                    f"{arm}.A must have length d*d = {d * d}, got {len(st.A)}"
                )
            if st.b and len(st.b) != d:
                raise ValueError(f"{arm}.b must have length d = {d}, got {len(st.b)}")
        return self


class UpdateRequest(BaseModel):
    ridge: float
    arm: ArmId
    x: list[float] = Field(min_length=1)
    reward: float
    state: ArmState

    @model_validator(mode="after")
    def _check_dims(self) -> UpdateRequest:
        d = len(self.x)
        if self.state.A and len(self.state.A) != d * d:
            raise ValueError(
                f"state.A must have length d*d = {d * d}, got {len(self.state.A)}"
            )
        if self.state.b and len(self.state.b) != d:
            raise ValueError(
                f"state.b must have length d = {d}, got {len(self.state.b)}"
            )
        return self


class PredictResponse(BaseModel):
    #: ``{ day: { arm: score } }`` — always all 5 arms for every requested day.
    scores: dict[str, dict[ArmId, float]]


class UpdateResponse(BaseModel):
    A: list[float]
    b: list[float]
