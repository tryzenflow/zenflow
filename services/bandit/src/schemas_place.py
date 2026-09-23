"""Wire contract for ``POST /v1/place`` (ADR-0003 section 3).

Mirrors ``packages/shared/src/placement.ts``. Requests are strict
(``extra="forbid"``) so contract drift fails loudly; responses are camelCase.
Instants are epoch-ms integers; ``dayStr`` is a local ``YYYY-MM-DD``.
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from src.core.constants import (
    FEATURE_DIM,
    MAX_SCAN_DAYS,
    PREFERENCE_MATRIX_LENGTH,
    TIME_GRANULARITY,
)
from src.schemas import ArmId, ArmState

PLACEMENT_CONTRACT_VERSION = 1
MAX_MEMBERS = 64

PlacementPolicy = Literal["HEURISTIC", "LINUCB"]
Outcome = Literal[
    "PLACED",
    "NEEDS_INFEASIBLE_CONTEXT",
    "DISPLACED",
    "ACCEPTED_CONFLICTS",
    "ACCEPTED_LATE",
    "INFEASIBLE",
]
WorkloadType = Literal["LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND"]


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel)


class _Resp(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class IntervalMs(_Req):
    start_ms: int
    end_ms: int


class WorkloadCell(_Req):
    hours: float = Field(ge=0)
    count: float = Field(ge=0)


class PlacementDay(_Req):
    day_str: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    day_start_ms: int
    day_end_ms: int
    occupied: list[IntervalMs]
    workload_by_type: dict[WorkloadType, WorkloadCell] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check(self) -> PlacementDay:
        if self.day_end_ms <= self.day_start_ms:
            raise ValueError("dayEndMs must be after dayStartMs")
        return self


class PlacementMember(_Req):
    id: str
    duration_minutes: int = Field(gt=0)
    prev_start_ms: int | None = None
    primary_policy: PlacementPolicy
    compute_both: bool

    @model_validator(mode="after")
    def _check(self) -> PlacementMember:
        if self.duration_minutes % TIME_GRANULARITY:
            raise ValueError("durationMinutes must be a multiple of 15")
        return self


class FlexibleWire(_Req):
    id: str
    duration_minutes: int = Field(gt=0)
    deadline_ms: int
    start_ms: int


class InfeasibleContext(_Req):
    policy: Literal["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"] | None = None
    flexible: list[FlexibleWire]
    fixed: list[IntervalMs]
    horizon_occupied: list[IntervalMs]


class UserWire(_Req):
    preference_matrix: list[float]
    observation_count: float = Field(ge=0)

    @model_validator(mode="after")
    def _check(self) -> UserWire:
        if len(self.preference_matrix) != PREFERENCE_MATRIX_LENGTH:
            raise ValueError(
                f"preferenceMatrix must have {PREFERENCE_MATRIX_LENGTH} entries"
            )
        if not all(math.isfinite(v) for v in self.preference_matrix):
            raise ValueError("preferenceMatrix must be finite")
        if not math.isfinite(self.observation_count):
            raise ValueError("observationCount must be finite")
        return self


class BanditWire(_Req):
    alpha: float = Field(ge=0)
    ridge: float = Field(gt=0)
    state: dict[ArmId, ArmState]

    @model_validator(mode="after")
    def _check(self) -> BanditWire:
        d = FEATURE_DIM
        if not (math.isfinite(self.alpha) and math.isfinite(self.ridge)):
            raise ValueError("alpha and ridge must be finite")
        for arm, st in self.state.items():
            if st.A and len(st.A) != d * d:
                raise ValueError(f"{arm}.A must have length {d * d}")
            if st.b and len(st.b) != d:
                raise ValueError(f"{arm}.b must have length {d}")
            if not all(math.isfinite(v) for v in [*st.A, *st.b]):
                raise ValueError(f"state for {arm} must be finite")
        return self


class PlaceRequest(_Req):
    contract_version: int
    request_id: str
    mode: Literal["PLACE", "PREFLIGHT"]
    now_ms: int
    timezone: str
    deadline_ms: int
    max_scan_days: int = Field(ge=1, le=MAX_SCAN_DAYS)
    members: list[PlacementMember] = Field(min_length=1, max_length=MAX_MEMBERS)
    fixed_occupied: list[IntervalMs]
    days: list[PlacementDay]
    user: UserWire
    bandit: BanditWire | None = None
    infeasible: InfeasibleContext | None = None

    @model_validator(mode="after")
    def _check(self) -> PlaceRequest:
        from zoneinfo import ZoneInfo

        try:
            ZoneInfo(self.timezone)
        except Exception as exc:  # unknown key / bad name
            raise ValueError(f"unknown timezone {self.timezone!r}") from exc
        strs = [d.day_str for d in self.days]
        if len(set(strs)) != len(strs):
            raise ValueError("days must have unique dayStr")
        return self


class HeuristicPick(_Resp):
    start_ms: int
    score: float


class Weights(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    wL: float = Field(alias="wL")  # noqa: N815
    wS: float = Field(alias="wS")  # noqa: N815


class LinucbPick(_Resp):
    start_ms: int
    score: float
    selected_arm: ArmId
    feature_vector: list[float]
    weights: Weights


class Move(_Resp):
    id: str
    from_ms: int
    to_ms: int


class PlacedMember(_Resp):
    id: str
    outcome: Outcome
    applied_policy: Literal["HEURISTIC", "LINUCB", "NONE"]
    heuristic: HeuristicPick | None
    linucb: LinucbPick | None
    start_ms: int | None
    moves: list[Move]
    late: bool
    conflicting: bool


class Timings(_Resp):
    decode: float
    context: float
    predict: float
    scan: float
    displace: float
    total: float


class PlaceResponse(_Resp):
    contract_version: int
    request_id: str
    params_version: str
    results: list[PlacedMember]
    timings_ms: Timings
