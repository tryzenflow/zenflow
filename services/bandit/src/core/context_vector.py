"""LinUCB context vector, d = 22 (port of ``context-vector.ts``)."""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
from numpy.typing import NDArray

from .constants import (
    DURATION_DIVISOR,
    FEATURE_DIM,
    MAX_SCAN_DAYS,
    WORKLOAD_COUNT_DIVISOR,
    WORKLOAD_HOURS_DIVISOR,
    WORKLOAD_TYPES,
)


def _clamp(x: float, lo: float, hi: float) -> float:
    return min(max(x, lo), hi)


def min_max_signed(x: float, divisor: float) -> float:
    return _clamp(x / divisor, 0.0, 1.0) * 2 - 1


def build_context_vector(
    *,
    remaining_days_until_deadline: float,
    duration_minutes: float,
    candidate_iso_weekday: int,
    candidate_days_from_now: float,
    workload_by_type: Mapping[str, Mapping[str, float]] | None = None,
    semester_phase: float | None = None,
) -> NDArray[np.float64]:
    workload = workload_by_type or {}
    vec: list[float] = [
        min_max_signed(remaining_days_until_deadline, MAX_SCAN_DAYS),
        min_max_signed(duration_minutes, DURATION_DIVISOR),
    ]
    vec += [1.0 if wd == candidate_iso_weekday else 0.0 for wd in range(1, 8)]
    vec.append(min_max_signed(candidate_days_from_now, MAX_SCAN_DAYS))
    for t in WORKLOAD_TYPES:
        w = workload.get(t, {})
        vec.append(_clamp(w.get("hours", 0) / WORKLOAD_HOURS_DIVISOR, 0.0, 1.0))
        vec.append(_clamp(w.get("count", 0) / WORKLOAD_COUNT_DIVISOR, 0.0, 1.0))
    vec.append(
        0.0 if semester_phase is None else _clamp(semester_phase, 0.0, 1.0) * 2 - 1
    )
    vec.append(1.0)
    if len(vec) != FEATURE_DIM:
        raise ValueError(f"produced {len(vec)} features, expected {FEATURE_DIM}")
    return np.asarray(vec, dtype=np.float64)
