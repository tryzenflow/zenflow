"""Slot scoring + heuristic best-free-slot with a vectorized scan
(port of ``slot-score.ts``)."""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .constants import (
    HOUR_MS,
    MS_PER_MINUTE,
    SLOT_MS,
    STABILITY_FAR_HOURS,
    STABILITY_NEAR_HOURS,
    STABILITY_SATURATION_HOURS,
    STABILITY_WEIGHT,
    STABILITY_WEIGHT_FAR,
    STABILITY_WEIGHT_NEAR,
    TIME_GRANULARITY,
)
from .preference import effective_preference_matrix
from .slot import Intervals, ceil_to_slot, floor_to_slot, local_cells

_TIE_DECIMALS = 9  # scores equal within 1e-9 tie -> earliest start wins


def stability_score(prev_start_ms: float, new_start_ms: float) -> float:
    dist_h = abs(new_start_ms - prev_start_ms) / HOUR_MS
    sat = min(dist_h, STABILITY_SATURATION_HOURS) / STABILITY_SATURATION_HOURS
    return -STABILITY_WEIGHT * sat


def stability_scores(
    prev_start_ms: float, starts_ms: NDArray[np.int64]
) -> NDArray[np.float64]:
    dist_h = np.abs(starts_ms - prev_start_ms) / HOUR_MS
    sat = np.minimum(dist_h, STABILITY_SATURATION_HOURS) / STABILITY_SATURATION_HOURS
    return np.asarray(-STABILITY_WEIGHT * sat, dtype=np.float64)


def stability_weight(prev_start_ms: float, now_ms: float) -> float:
    """Stability weight for a task whose current start is ``prev_start_ms``:
    ``NEAR`` while it is <= ``NEAR_HOURS`` away (or already past), fading
    linearly to ``FAR`` at ``FAR_HOURS``."""
    lead_h = max(0.0, prev_start_ms - now_ms) / HOUR_MS
    t = (lead_h - STABILITY_NEAR_HOURS) / (STABILITY_FAR_HOURS - STABILITY_NEAR_HOURS)
    t = min(1.0, max(0.0, t))
    return STABILITY_WEIGHT_NEAR + (STABILITY_WEIGHT_FAR - STABILITY_WEIGHT_NEAR) * t


def proximity_stability_scores(
    prev_start_ms: float, starts_ms: NDArray[np.int64], now_ms: float
) -> NDArray[np.float64]:
    """:func:`stability_scores` shape (saturating at ``SATURATION_HOURS``),
    scaled by :func:`stability_weight` instead of the fixed heuristic weight."""
    dist_h = np.abs(starts_ms - prev_start_ms) / HOUR_MS
    sat = np.minimum(dist_h, STABILITY_SATURATION_HOURS) / STABILITY_SATURATION_HOURS
    w = stability_weight(prev_start_ms, now_ms)
    return np.asarray(-w * sat, dtype=np.float64)


def slot_preference_scores(
    pref_matrix: ArrayLike,
    starts_ms: NDArray[np.int64],
    duration_minutes: int,
    timezone: str,
) -> NDArray[np.float64]:
    """Overlap-weighted preference score of ``[s, s + duration)`` for every
    slot-aligned start in ``starts_ms`` (one prefix-sum pass)."""
    if duration_minutes <= 0 or duration_minutes % TIME_GRANULARITY:
        raise ValueError("duration must be a positive multiple of 15")
    if starts_ms.size == 0:
        return np.empty(0)
    matrix = effective_preference_matrix(pref_matrix)
    n = duration_minutes // TIME_GRANULARITY
    first = int(starts_ms.min() // SLOT_MS)
    last = int(starts_ms.max() // SLOT_MS)
    span = last - first + n
    piece = matrix[local_cells(first, span, timezone)] * 0.25
    cs = np.concatenate(([0.0], np.cumsum(piece)))
    idx = (starts_ms // SLOT_MS - first).astype(np.int64)
    return np.asarray(cs[idx + n] - cs[idx], dtype=np.float64)


def slot_preference_score(
    pref_matrix: ArrayLike,
    start_ms: int,
    end_ms: int,
    timezone: str,
) -> float:
    dur = (end_ms - start_ms) // MS_PER_MINUTE
    return float(
        slot_preference_scores(
            pref_matrix, np.array([start_ms], dtype=np.int64), dur, timezone
        )[0]
    )


def free_start_mask(
    first_ms: int, n: int, duration_ms: int, occupied: Intervals
) -> NDArray[np.bool_]:
    """For the ``n`` slot-aligned starts ``first_ms + i*SLOT_MS``: True where
    ``[s, s + duration)`` overlaps no occupied interval (difference-array pass)."""
    diff = np.zeros(n + 1, dtype=np.int64)
    for o_start, o_end in occupied:
        # blocked starts: o_start - duration < s < o_end
        lo = (o_start - duration_ms - first_ms) // SLOT_MS + 1
        hi = -((first_ms - o_end) // SLOT_MS)  # ceil((o_end - first) / SLOT)
        lo, hi = max(lo, 0), min(hi, n)
        if lo < hi:
            diff[lo] += 1
            diff[hi] -= 1
    return np.asarray(np.cumsum(diff[:n]) == 0, dtype=np.bool_)


def best_free_slot(
    duration_minutes: int,
    occupied: Intervals,
    window_start_ms: int,
    window_end_ms: int,
    pref_matrix: ArrayLike,
    timezone: str,
    fit_window_end_ms: int | None = None,
    prev_start_ms: int | None = None,
) -> int | None:
    """Free 15-min-aligned start with the highest preference score (earliest
    wins ties); ``None`` when nothing fits."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    start_ceil = floor_to_slot(window_end_ms)
    fit_ceil = floor_to_slot(
        window_end_ms if fit_window_end_ms is None else fit_window_end_ms
    )
    first = ceil_to_slot(window_start_ms)
    hi = min(start_ceil, fit_ceil - duration_ms + 1)  # exclusive upper bound
    if hi <= first:
        return None
    starts = np.arange(first, hi, SLOT_MS, dtype=np.int64)
    starts = starts[free_start_mask(first, starts.size, duration_ms, occupied)]
    if starts.size == 0:
        return None
    total = slot_preference_scores(pref_matrix, starts, duration_minutes, timezone)
    if prev_start_ms is not None:
        total = total + stability_scores(prev_start_ms, starts)
    total = np.round(total, _TIE_DECIMALS)
    return int(starts[int(np.argmax(total))])  # argmax -> first (earliest) max
