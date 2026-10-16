"""Placement reason codes (issue #254). Pure: no I/O, no clock, no randomness."""

from __future__ import annotations

from typing import Literal

from src.core.constants import MS_PER_MINUTE, SLOT_MS
from src.core.slot import Intervals, ceil_to_slot, floor_to_slot

PlacementReason = Literal[
    "PREFERRED_HOUR",
    "BEFORE_DEADLINE",
    "ONLY_FREE_SLOT",
    "NEAR_CLASS",
    "MOVED_FOR_DEADLINE",
    "BEST_AVAILABLE",
]

# Preference-matrix cell at the start at or above which the hour counts as one
# the user usually works in.
PREFERRED_HOUR_MIN = 0.5
# A start within this gap of an occupied block counts as next to a class.
NEAR_CLASS_GAP_MINUTES = 30

_MOVED_OUTCOMES = frozenset({"DISPLACED", "NEEDS_CONFIRMATION"})


def count_free_starts(
    occupied: Intervals,
    lo: int,
    start_ceil: int,
    fit_ceil: int,
    dur_ms: int,
) -> int:
    """On-grid starts ``s`` with ``lo <= s < start_ceil`` where ``[s, s+dur)``
    fits in ``[lo, fit_ceil)`` and overlaps no ``occupied`` interval."""
    blocks = sorted(
        (max(s, lo), min(e, fit_ceil)) for s, e in occupied if e > lo and s < fit_ceil
    )
    gaps: Intervals = []
    cursor = lo
    for s, e in blocks:
        if s > cursor:
            gaps.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < fit_ceil:
        gaps.append((cursor, fit_ceil))

    total = 0
    for g0, g1 in gaps:
        first = ceil_to_slot(g0)
        last = min(g1 - dur_ms, start_ceil - SLOT_MS)
        if last >= first:
            total += (floor_to_slot(last) - first) // SLOT_MS + 1
    return total


def is_near_block(occupied: Intervals, start: int, dur_ms: int) -> bool:
    """True when ``[start, start+dur)`` touches or is within the near-class gap
    of an ``occupied`` interval."""
    gap = NEAR_CLASS_GAP_MINUTES * MS_PER_MINUTE
    end = start + dur_ms
    return any(s < end + gap and e > start - gap for s, e in occupied)


def placement_reason(
    outcome: str,
    *,
    free_starts: int,
    preference: float,
    near_class: bool,
) -> PlacementReason:
    """Why the applied start was chosen. Only meaningful when a start exists.

    ``PLACED`` takes the first matching rule: only free slot, preferred hour,
    near class, else before deadline. Moved outcomes and accepted or last-resort
    starts get their own code.
    """
    if outcome in _MOVED_OUTCOMES:
        return "MOVED_FOR_DEADLINE"
    if outcome != "PLACED":
        return "BEST_AVAILABLE"
    if free_starts == 1:
        return "ONLY_FREE_SLOT"
    if preference >= PREFERRED_HOUR_MIN:
        return "PREFERRED_HOUR"
    if near_class:
        return "NEAR_CLASS"
    return "BEFORE_DEADLINE"
