"""LinUCB context vector, d = 7.

Deliberately small so each disjoint arm warms up in a handful of rewards:

====  ==============================================================
0     remaining days until deadline, signed ``/ MAX_SCAN_DAYS``
1     duration, signed ``/ DURATION_DIVISOR``
2     candidate days from now, signed ``/ MAX_SCAN_DAYS``
3     candidate day is a weekend (ISO 6/7) -> +1, else -1 (signed, so
      ``||x||`` -- hence the exploration bonus -- doesn't favour weekends)
4     fixed-load hours (LECTURE+EXAM+DND) on the day, ``/ 12`` clamped
5     flexible-load hours (TASK+ASSIGNMENT) on the day, ``/ 12`` clamped
6     bias, 1
====  ==============================================================

Per-weekday one-hots (collinear with the bias), per-type workload hours and
counts, and the never-populated semester phase were dropped in the d=22 -> 7
reshape (ADR-0001 amendment, 2026-09-23).
"""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
from numpy.typing import NDArray

from .constants import (
    DURATION_DIVISOR,
    FEATURE_DIM,
    FIXED_LOAD_TYPES,
    FLEX_LOAD_TYPES,
    MAX_SCAN_DAYS,
    WORKLOAD_HOURS_DIVISOR,
)


def _clamp(x: float, lo: float, hi: float) -> float:
    return min(max(x, lo), hi)


def min_max_signed(x: float, divisor: float) -> float:
    return _clamp(x / divisor, 0.0, 1.0) * 2 - 1


def _load_hours(
    workload: Mapping[str, Mapping[str, float]], types: tuple[str, ...]
) -> float:
    hours = sum(workload.get(t, {}).get("hours", 0) for t in types)
    return _clamp(hours / WORKLOAD_HOURS_DIVISOR, 0.0, 1.0)


def build_context_vector(
    *,
    remaining_days_until_deadline: float,
    duration_minutes: float,
    candidate_iso_weekday: int,
    candidate_days_from_now: float,
    workload_by_type: Mapping[str, Mapping[str, float]] | None = None,
) -> NDArray[np.float64]:
    workload = workload_by_type or {}
    vec = [
        min_max_signed(remaining_days_until_deadline, MAX_SCAN_DAYS),
        min_max_signed(duration_minutes, DURATION_DIVISOR),
        min_max_signed(candidate_days_from_now, MAX_SCAN_DAYS),
        1.0 if candidate_iso_weekday >= 6 else -1.0,
        _load_hours(workload, FIXED_LOAD_TYPES),
        _load_hours(workload, FLEX_LOAD_TYPES),
        1.0,
    ]
    if len(vec) != FEATURE_DIM:
        raise ValueError(f"produced {len(vec)} features, expected {FEATURE_DIM}")
    return np.asarray(vec, dtype=np.float64)
