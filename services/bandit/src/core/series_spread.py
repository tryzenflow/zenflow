"""Non-overlapping day windows for a TASK series (port of ``series-spread.ts``)."""

from __future__ import annotations

import math

from src.core.constants import MAX_SERIES_PER_DAY


def series_day_windows(day_span: float, count: float) -> list[tuple[int, int]]:
    span = max(0, math.floor(day_span))
    total_days = span + 1
    n = max(1, math.floor(count))
    if n > total_days:
        # More sittings than days: spread them evenly, a few to a day.
        return [((i * total_days) // n, (i * total_days) // n) for i in range(n)]
    base, remainder = divmod(total_days, n)
    windows: list[tuple[int, int]] = []
    cursor = 0
    for i in range(n):
        size = max(1, base + (1 if i >= n - remainder else 0))
        lo = min(cursor, span)
        hi = min(span, lo + size - 1)
        windows.append((lo, hi))
        cursor += size
    return windows


def series_day_cap(day_span: float, count: float) -> int:
    """Most sittings of one series on a day: ``MAX_SERIES_PER_DAY``, raised so
    ``count`` sittings always fit across the ``day_span + 1`` days."""
    total_days = max(0, math.floor(day_span)) + 1
    n = max(1, math.floor(count))
    return max(MAX_SERIES_PER_DAY, math.ceil(n / total_days))
