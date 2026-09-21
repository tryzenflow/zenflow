"""Preference matrix helpers + decay (port of ``preference.ts`` / ``matrix-decay.ts``).

The matrix is a flat 168-float array: 7 ISO weekdays x 24 hour buckets.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .constants import (
    MATRIX_HALF_LIFE_DAYS,
    PREFERENCE_LEARNING_RATE,
    PREFERENCE_MATRIX_LENGTH,
    PREFERENCE_SLOTS_PER_DAY,
)
from .reward import drag_distance_reward
from .slot import iso_weekday, local_date_str, utc_to_minutes


def matrix_index(iso_weekday_num: int, hour: int) -> int:
    return (iso_weekday_num - 1) * PREFERENCE_SLOTS_PER_DAY + hour


def default_preference_matrix() -> NDArray[np.float64]:
    m = np.zeros(PREFERENCE_MATRIX_LENGTH)
    for wd in range(1, 8):
        m[matrix_index(wd, 8) : matrix_index(wd, 11)] = 1.0
        m[matrix_index(wd, 14) : matrix_index(wd, 17)] = 0.5
        m[matrix_index(wd, 19) : matrix_index(wd, 22)] = 0.2
    return m


def effective_preference_matrix(pref: ArrayLike) -> NDArray[np.float64]:
    arr = np.asarray(pref, dtype=np.float64)
    if arr.shape == (PREFERENCE_MATRIX_LENGTH,):
        return arr
    return default_preference_matrix()


def cell_index_at(at_ms: int, timezone: str) -> int:
    return matrix_index(
        iso_weekday(local_date_str(at_ms, timezone)),
        utc_to_minutes(at_ms, timezone) // 60,
    )


def preference_score_at(matrix: ArrayLike, at_ms: int, timezone: str) -> float:
    return float(np.asarray(matrix)[cell_index_at(at_ms, timezone)])


def reinforce_preference_cell(
    matrix: ArrayLike,
    at_ms: int,
    timezone: str,
    delta: float,
    rate: float = PREFERENCE_LEARNING_RATE,
) -> NDArray[np.float64]:
    nxt = effective_preference_matrix(matrix).copy()
    idx = cell_index_at(at_ms, timezone)
    nxt[idx] = min(max(nxt[idx] + rate * delta, -1.0), 1.0)
    return nxt


def reinforce_preference_move(
    matrix: ArrayLike,
    old_start_ms: int,
    new_start_ms: int,
    timezone: str,
    drag_distance_minutes: float,
    rate: float = PREFERENCE_LEARNING_RATE,
) -> NDArray[np.float64]:
    grade = -drag_distance_reward(drag_distance_minutes)
    same = cell_index_at(old_start_ms, timezone) == cell_index_at(
        new_start_ms, timezone
    )
    if grade == 0 or same:
        return effective_preference_matrix(matrix).copy()
    lowered = reinforce_preference_cell(matrix, old_start_ms, timezone, -grade, rate)
    return reinforce_preference_cell(lowered, new_start_ms, timezone, grade, rate)


def decay_matrix(
    matrix: ArrayLike,
    delta_days: float,
    half_life_days: float = MATRIX_HALF_LIFE_DAYS,
) -> NDArray[np.float64]:
    arr = np.asarray(matrix, dtype=np.float64)
    if not delta_days > 0 or not half_life_days > 0:
        return arr.copy()
    return np.asarray(arr * 2.0 ** (-delta_days / half_life_days), dtype=np.float64)
