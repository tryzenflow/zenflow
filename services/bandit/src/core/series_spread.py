"""Non-overlapping day windows for a TASK series (port of ``series-spread.ts``)."""

from __future__ import annotations

import math


def series_day_windows(day_span: float, count: float) -> list[tuple[int, int]]:
    span = max(0, math.floor(day_span))
    total_days = span + 1
    n = max(1, math.floor(count))
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
