"""Slot-first LinUCB search (port of ``linucb-best-slot.ts``, issue #62 A).

Every feasible 15-min start on every candidate day is scored

    score = sum_arm overlapRate(slot, arm) * armScore[day][arm]
          + wS * stability(prevStart, slot)

where ``wS`` = :func:`~.slot_score.stability_weight` (strong for a task about
to start, fading for distant ones). Ranked across days; exact ties (within
1e-9 -- e.g. every arm cold) go to the arm hosting the start in the given
``tie_break_order`` (seeded per request by the caller), then the earlier
start. Vectorized per day.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .arms import ARM_BANDS, TIE_BREAK_ARM_ORDER, arm_of_minute, overlap_rate
from .constants import MS_PER_MINUTE, SLOT_MS
from .slot import Intervals, ceil_to_slot, utc_to_minutes
from .slot_score import free_start_mask, proximity_stability_scores, stability_weight

_TIE_DECIMALS = 9
_ARM_NAMES = [b[0] for b in ARM_BANDS]
_BAND_STARTS = np.array([b[1] for b in ARM_BANDS], dtype=np.int64)


@dataclass(frozen=True)
class LinucbCandidateDay:
    day_str: str
    day_start_ms: int
    day_end_ms: int
    occupied: Intervals
    vector: list[float]
    arm_scores: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class BestLinucbSlot:
    start_ms: int
    score: float
    arm: str
    vector: list[float]
    stability_weight: float  # wS actually applied (0 without a prev start)


def _rates_plain(start_min: NDArray[np.float64], duration: int) -> NDArray[np.float64]:
    """(n_slots, n_arms) overlap rates from wall-clock minutes (24h days)."""
    end = start_min + duration
    out = np.zeros((start_min.size, len(ARM_BANDS)))
    n_days = int(np.ceil(end.max() / 1440)) if end.size else 0
    for j, (_, b_start, b_end) in enumerate(ARM_BANDS):
        for d in range(n_days):
            lo, hi = b_start + d * 1440, b_end + d * 1440
            out[:, j] += np.maximum(
                0.0, np.minimum(end, hi) - np.maximum(start_min, lo)
            )
    return out / duration


def best_linucb_slot(
    days: Sequence[LinucbCandidateDay],
    duration_minutes: int,
    timezone: str,
    next_ms: int,
    deadline_ms: int,
    extra_occupied: Intervals | None = None,
    prev_start_ms: int | None = None,
    tie_break_order: Sequence[str] = TIE_BREAK_ARM_ORDER,
) -> BestLinucbSlot | None:
    tie_rank = {a: i for i, a in enumerate(tie_break_order)}
    rank_by_band = np.array([tie_rank[a] for a in _ARM_NAMES], dtype=np.int64)
    w_s = stability_weight(prev_start_ms, next_ms) if prev_start_ms is not None else 0.0
    duration_ms = duration_minutes * MS_PER_MINUTE
    overhang = duration_ms - SLOT_MS
    extra = extra_occupied or []

    scores: list[NDArray[np.float64]] = []
    ranks: list[NDArray[np.int64]] = []
    starts_all: list[NDArray[np.int64]] = []
    day_idx: list[NDArray[np.int64]] = []

    for di, day in enumerate(days):
        lower = max(ceil_to_slot(day.day_start_ms), next_ms)
        upper = min(day.day_end_ms + overhang, deadline_ms)
        if lower + duration_ms > upper:
            continue
        n = (upper - duration_ms - lower) // SLOT_MS + 1
        mask = free_start_mask(lower, n, duration_ms, [*day.occupied, *extra])
        if not mask.any():
            continue
        starts = lower + np.arange(n, dtype=np.int64)[mask] * SLOT_MS
        arm_vec = np.array([day.arm_scores.get(a, 0.0) for a in _ARM_NAMES])

        if day.day_end_ms - day.day_start_ms == 1440 * MS_PER_MINUTE:
            smin = (starts - day.day_start_ms) / MS_PER_MINUTE
            rates = _rates_plain(smin, duration_minutes)
            band = (
                np.searchsorted(
                    _BAND_STARTS, np.floor(smin).astype(np.int64) % 1440, "right"
                )
                - 1
            )
        else:  # DST day: exact timezone-aware path, scalar
            rates = np.array(
                [
                    [
                        overlap_rate(int(s), int(s) + duration_ms, a, timezone)
                        for a in _ARM_NAMES
                    ]
                    for s in starts
                ]
            )
            band = np.array(
                [
                    _ARM_NAMES.index(arm_of_minute(utc_to_minutes(int(s), timezone)))
                    for s in starts
                ],
                dtype=np.int64,
            )
        total = rates @ arm_vec
        if prev_start_ms is not None:
            total = total + proximity_stability_scores(prev_start_ms, starts, next_ms)
        scores.append(total)
        ranks.append(rank_by_band[band])
        starts_all.append(starts)
        day_idx.append(np.full(starts.size, di, dtype=np.int64))

    if not scores:
        return None
    sc = np.concatenate(scores)
    rk = np.concatenate(ranks)
    st = np.concatenate(starts_all)
    di_all = np.concatenate(day_idx)
    order = np.lexsort((st, rk, -np.round(sc, _TIE_DECIMALS)))
    i = int(order[0])
    return BestLinucbSlot(
        start_ms=int(st[i]),
        score=float(sc[i]),
        arm=tie_break_order[int(rk[i])],
        vector=list(days[int(di_all[i])].vector),
        stability_weight=w_s,
    )


def days_from_dicts(raw: Sequence[Mapping[str, Any]]) -> list[LinucbCandidateDay]:
    """Build days from the golden-fixture / TS JSON shape."""
    return [
        LinucbCandidateDay(
            day_str=d["dayStr"],
            day_start_ms=d["dayStartMs"],
            day_end_ms=d["dayEndMs"],
            occupied=[(o["start"], o["end"]) for o in d["occupied"]],
            vector=list(d["vector"]),
            arm_scores=dict(d["armScores"]),
        )
        for d in raw
    ]
