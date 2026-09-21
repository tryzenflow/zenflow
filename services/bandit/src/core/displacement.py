"""Flexible-task displacement (port of ``displacement.ts``, issue #62 B)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from .constants import (
    DISPLACEMENT_CANDIDATES,
    HOUR_MS,
    MAX_DISPLACED_TASKS,
    MS_PER_MINUTE,
    SLOT_MS,
)
from .slot import Intervals, ceil_to_slot, overlaps_any
from .slot_score import (
    best_free_slot,
    free_start_mask,
    slot_preference_scores,
)

_TIE_DECIMALS = 9


@dataclass(frozen=True)
class FlexibleTask:
    id: str
    duration_minutes: int
    deadline_ms: int
    start_ms: int

    @property
    def end_ms(self) -> int:
        return self.start_ms + self.duration_minutes * MS_PER_MINUTE


@dataclass(frozen=True)
class DisplacementMove:
    id: str
    from_ms: int
    to_ms: int


@dataclass(frozen=True)
class DisplacementPlan:
    kind: str  # "placed" | "infeasible"
    start_ms: int | None = None
    moves: tuple[DisplacementMove, ...] = ()


def _cascade(
    candidate: tuple[int, int],
    obstacles: Intervals,
    participants: Sequence[FlexibleTask],
    win: tuple[int, int],
    lower_ms: int,
    pref_matrix: ArrayLike,
    timezone: str,
    max_moves: int,
) -> list[DisplacementMove] | None:
    occupied: Intervals = [*obstacles, candidate]
    moves: list[DisplacementMove] = []
    for p in sorted(participants, key=lambda t: (t.deadline_ms, t.id)):
        if not overlaps_any(occupied, p.start_ms, p.end_ms):
            occupied.append((p.start_ms, p.end_ms))
            continue
        ceiling = min(p.deadline_ms, win[1])
        slot = best_free_slot(
            p.duration_minutes,
            occupied,
            max(lower_ms, win[0]),
            ceiling,
            pref_matrix,
            timezone,
            ceiling,
            p.start_ms,
        )
        if slot is None:
            return None
        moves.append(DisplacementMove(p.id, p.start_ms, slot))
        if len(moves) > max_moves:
            return None
        occupied.append((slot, slot + p.duration_minutes * MS_PER_MINUTE))
    return moves


def plan_displacement(
    task_duration_minutes: int,
    task_deadline_ms: int,
    flexible: Sequence[FlexibleTask],
    fixed: Intervals,
    now_ms: int,
    windows: Sequence[tuple[int, int]],
    pref_matrix: ArrayLike,
    timezone: str,
    max_moves: int | None = None,
    candidates: int | None = None,
) -> DisplacementPlan:
    max_moves = MAX_DISPLACED_TASKS if max_moves is None else max_moves
    k = DISPLACEMENT_CANDIDATES if candidates is None else candidates
    duration_ms = task_duration_minutes * MS_PER_MINUTE
    duration_hours = duration_ms / HOUR_MS
    lower_ms = ceil_to_slot(now_ms)

    for win in windows:
        participants = [
            f
            for f in flexible
            if f.end_ms > win[0] and f.start_ms < win[1] and f.start_ms >= lower_ms
        ]
        p_ids = {p.id for p in participants}
        obstacles: Intervals = [
            *fixed,
            *((f.start_ms, f.end_ms) for f in flexible if f.id not in p_ids),
        ]

        first = max(lower_ms, ceil_to_slot(win[0]))
        hi = min(win[1], task_deadline_ms - duration_ms + 1)  # exclusive
        cand_starts = np.empty(0, dtype=np.int64)
        cand_scores = np.empty(0)
        if hi > first:
            n = -((first - hi) // SLOT_MS)  # ceil((hi - first) / SLOT)
            starts = first + np.arange(n, dtype=np.int64) * SLOT_MS
            starts = starts[free_start_mask(first, n, duration_ms, obstacles)]
            if starts.size:
                sc = (
                    slot_preference_scores(
                        pref_matrix, starts, task_duration_minutes, timezone
                    )
                    / duration_hours
                )
                order = np.lexsort((starts, -np.round(sc, _TIE_DECIMALS)))
                cand_starts, cand_scores = starts[order][:k], sc[order][:k]

        best: tuple[int, float, list[DisplacementMove]] | None = None
        for s, score in zip(cand_starts.tolist(), cand_scores.tolist(), strict=True):
            moves = _cascade(
                (s, s + duration_ms),
                obstacles,
                participants,
                win,
                lower_ms,
                pref_matrix,
                timezone,
                max_moves,
            )
            if moves is None:
                continue
            if (
                best is None
                or len(moves) < len(best[2])
                or (len(moves) == len(best[2]) and score > best[1] + 1e-9)
            ):
                best = (s, score, moves)
        if best is not None:
            return DisplacementPlan("placed", best[0], tuple(best[2]))
    return DisplacementPlan("infeasible")


def pick_min_conflict_slot(
    duration_minutes: int,
    now_ms: int,
    deadline_ms: int,
    occupied: Intervals,
    pref_matrix: ArrayLike,
    timezone: str,
) -> int | None:
    """Start before the deadline overlapping the least calendar time (ties:
    better preference, then earlier)."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    first = ceil_to_slot(now_ms)
    if first + duration_ms > deadline_ms:
        return None
    n = (deadline_ms - duration_ms - first) // SLOT_MS + 1
    starts = first + np.arange(n, dtype=np.int64) * SLOT_MS
    overlap = np.zeros(n, dtype=np.int64)
    for o_start, o_end in occupied:
        overlap += np.maximum(
            0, np.minimum(o_end, starts + duration_ms) - np.maximum(o_start, starts)
        )
    score = np.round(
        slot_preference_scores(pref_matrix, starts, duration_minutes, timezone),
        _TIE_DECIMALS,
    )
    return int(starts[int(np.lexsort((starts, -score, overlap))[0])])


def pick_late_slot(
    duration_minutes: int,
    now_ms: int,
    deadline_ms: int,
    occupied: Intervals,
    horizon_end_ms: int | None = None,
) -> int | None:
    """Earliest conflict-free start at/after now whose END passes the deadline."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    horizon = (
        deadline_ms + 30 * 24 * 60 * MS_PER_MINUTE
        if horizon_end_ms is None
        else horizon_end_ms
    )
    first = max(ceil_to_slot(now_ms), ceil_to_slot(deadline_ms - duration_ms + 1))
    if first + duration_ms > horizon:
        return None
    n = (horizon - duration_ms - first) // SLOT_MS + 1
    free = np.flatnonzero(free_start_mask(first, n, duration_ms, occupied))
    return int(first + free[0] * SLOT_MS) if free.size else None


def flexible_from_dicts(raw: Sequence[dict[str, Any]]) -> list[FlexibleTask]:
    return [
        FlexibleTask(f["id"], f["durationMinutes"], f["deadlineMs"], f["startMs"])
        for f in raw
    ]
