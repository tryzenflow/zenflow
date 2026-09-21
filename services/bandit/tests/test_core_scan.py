"""Vectorized slot scan vs a literal scalar transcription of TS ``bestFreeSlot``."""

from __future__ import annotations

import numpy as np
import pytest

from src.core.constants import HOUR_MS, MS_PER_MINUTE, SLOT_MS
from src.core.preference import matrix_index, preference_score_at
from src.core.slot import (
    ceil_to_slot,
    floor_to_slot,
    iso_weekday,
    local_date_str,
    overlaps_any,
    utc_to_minutes,
)
from src.core.slot_score import best_free_slot, stability_score


def _scalar_score(m: np.ndarray, s: int, e: int, tz: str) -> float:
    total, cur = 0.0, s
    while cur < e:
        block_end = cur + (60 - utc_to_minutes(cur, tz) % 60) * MS_PER_MINUTE
        seg = min(block_end, e)
        total += (seg - cur) / HOUR_MS * preference_score_at(m, cur, tz)
        cur = seg
    return total


def _scalar_best(dur, occ, ws, we, m, tz, fit=None, prev=None):  # type: ignore[no-untyped-def]
    dur_ms = dur * MS_PER_MINUTE
    sc, fc = floor_to_slot(we), floor_to_slot(we if fit is None else fit)
    best: tuple[int, float] | None = None
    s = ceil_to_slot(ws)
    while s < sc:
        e = s + dur_ms
        if e <= fc and not overlaps_any(occ, s, e):
            t = _scalar_score(m, s, e, tz) + (
                stability_score(prev, s) if prev is not None else 0.0
            )
            if best is None or t > best[1] + 1e-9:
                best = (s, t)
        s += SLOT_MS
    return None if best is None else best[0]


@pytest.mark.parametrize(
    "tz,start",
    [
        ("UTC", 1_767_571_200_000),
        ("Asia/Kolkata", 1_767_571_200_000),  # +05:30, half-hour blocks
        ("America/New_York", 1_772_960_000_000),  # spans 2026-03-08 DST start
        ("Europe/Paris", 1_792_000_000_000),  # spans 2026-10-25 DST end
    ],
)
def test_vectorized_matches_scalar(tz: str, start: int) -> None:
    rng = np.random.default_rng(7)
    for _ in range(4):
        m = rng.uniform(-1, 1, 168)
        dur = int(rng.choice([15, 45, 60, 135, 240]))
        ws = start + int(rng.integers(0, 96)) * SLOT_MS + 1
        we = ws + 3 * 86_400_000
        occ = [
            (ws + int(a) * SLOT_MS, ws + int(a) * SLOT_MS + int(b) * SLOT_MS)
            for a, b in zip(
                rng.integers(0, 280, 6), rng.integers(1, 20, 6), strict=True
            )
        ]
        prev = ws + 100 * SLOT_MS if rng.random() < 0.5 else None
        fit = we + dur * MS_PER_MINUTE
        args = (dur, occ, ws, we, m, tz, fit, prev)
        assert best_free_slot(*args) == _scalar_best(*args)


def test_weekday_cells_match_helpers() -> None:
    from src.core.slot import local_cells

    first = 1_767_571_200_000 // SLOT_MS
    cells = local_cells(first, 96 * 9, "Asia/Kolkata")
    for i in range(0, 96 * 9, 37):
        t = (first + i) * SLOT_MS
        want = matrix_index(
            iso_weekday(local_date_str(t, "Asia/Kolkata")),
            utc_to_minutes(t, "Asia/Kolkata") // 60,
        )
        assert cells[i] == want
