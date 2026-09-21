"""LinUCB time-of-day arm bands (port of ``arms.ts``)."""

from __future__ import annotations

import math

from .slot import utc_to_minutes

ARM_BANDS: tuple[tuple[str, int, int], ...] = (
    ("EARLY_MORNING", 0, 360),
    ("MORNING", 360, 660),
    ("AFTERNOON", 660, 1020),
    ("EVENING", 1020, 1200),
    ("NIGHT", 1200, 1440),
)


def arm_of_minute(minute_of_day: float) -> str:
    m = math.floor(minute_of_day) % 1440
    for arm, start, end in ARM_BANDS:
        if start <= m < end:
            return arm
    return "NIGHT"


def overlap_rate(start_ms: int, end_ms: int, arm: str, timezone: str) -> float:
    """Fraction of ``[start, end)`` whose local minute-of-day is inside ``arm``."""
    if end_ms <= start_ms:
        return 0.0
    band = next((b for b in ARM_BANDS if b[0] == arm), None)
    if band is None:
        raise ValueError(f"overlap_rate: unknown arm {arm}")
    _, b_start, b_end = band
    total = (end_ms - start_ms) / 60_000
    overlap = 0.0
    cursor = start_ms
    while cursor < end_ms:
        seg_start_min = utc_to_minutes(cursor, timezone)
        day_end = cursor + (1440 - seg_start_min) * 60_000
        seg_end = min(day_end, end_ms)
        seg_end_min = seg_start_min + (seg_end - cursor) / 60_000
        overlap += max(0.0, min(seg_end_min, b_end) - max(seg_start_min, b_start))
        cursor = seg_end
    return overlap / total
