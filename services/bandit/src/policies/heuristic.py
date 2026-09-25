"""Heuristic placement policy: best per-day preference slot (issue #62)."""

from __future__ import annotations

from collections.abc import Sequence

from src.core import constants as consts
from src.core.slot import Intervals
from src.core.slot_score import best_free_slot, slot_preference_score, stability_score
from src.schemas_place import HeuristicPick, PlacementDay, PlacementMember


class HeuristicPolicy:
    """Best-per-day preference-matrix slot search.

    Scans every candidate day's free intervals for the highest-scoring
    15-minute start (:func:`~src.core.slot_score.slot_preference_score`, plus
    a stability bonus toward ``prev_start_ms``), and returns the best pick
    across all days.
    """

    def __init__(self, matrix: Sequence[float], timezone: str) -> None:
        self.matrix = matrix
        self.tz = timezone

    def best_slot(
        self,
        member: PlacementMember,
        days: list[PlacementDay],
        occupied_by_day: dict[str, Intervals],
        extra: Intervals,
        now_ms: int,
        deadline_ms: int,
    ) -> HeuristicPick | None:
        dur_ms = member.duration_minutes * consts.MS_PER_MINUTE
        overhang = dur_ms - consts.SLOT_MS
        best: HeuristicPick | None = None
        for d in days:
            start_ceil = min(deadline_ms, d.day_end_ms)
            fit_ceil = min(deadline_ms, d.day_end_ms + overhang)
            window_start = max(now_ms, d.day_start_ms)
            slot = best_free_slot(
                member.duration_minutes,
                [*occupied_by_day[d.day_str], *extra],
                window_start,
                start_ceil,
                self.matrix,
                self.tz,
                fit_ceil,
                member.prev_start_ms,
            )
            if slot is None:
                continue
            score = slot_preference_score(self.matrix, slot, slot + dur_ms, self.tz)
            if member.prev_start_ms is not None:
                score += stability_score(member.prev_start_ms, slot)
            if best is None or score > best.score:
                best = HeuristicPick(start_ms=slot, score=score)
        return best
