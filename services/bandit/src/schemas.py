"""Wire contract for the bandit HTTP surface — Pydantic request/response models.

Field names must match the NestJS backend exactly (ADR-0001 §6.1). ``d`` (the
context dimension, 22 in production) is **inferred** from the length of ``x`` and
validated by the cross-field ``model_validator``s here — never hardcoded.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

#: Canonical time-of-day arms (``SchedulingArm`` in ``@zenflow/shared``),
#: half-open and lower-inclusive: 00-06 / 06-11 / 11-14 / 14-17 / 17-20 / 20-24.
ArmId = Literal["EARLY_MORNING", "MORNING", "MIDDAY", "AFTERNOON", "EVENING", "NIGHT"]

ARM_IDS: tuple[ArmId, ...] = (
    "EARLY_MORNING",
    "MORNING",
    "MIDDAY",
    "AFTERNOON",
    "EVENING",
    "NIGHT",
)


class ArmState(BaseModel):
    """Per-arm ridge-regression state.

    ``A`` is ``d*d`` floats row-major; ``b`` is ``d`` floats. Either list may be
    empty, meaning "no data yet": the arm falls back to the cold ridge prior
    (``A = ridge·I``, ``b = 0``) and scores its full exploration bonus.
    """

    A: list[float] = Field(default_factory=list)
    b: list[float] = Field(default_factory=list)


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


class UpdateResponse(BaseModel):
    A: list[float]
    b: list[float]
