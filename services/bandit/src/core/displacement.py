"""Flexible-task displacement (issue #62 B): EDF eviction with spillover."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from .constants import (
    MAX_DISPLACED_TASKS,
    MS_PER_MINUTE,
    SLOT_MS,
)
from .slot import Intervals, ceil_to_slot, floor_to_slot, overlaps_any
from .slot_score import free_start_mask, slot_preference_scores

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


def nearest_free_start(
    duration_minutes: int,
    occupied: Intervals,
    lower_ms: int,
    fit_end_ms: int,
    target_ms: int,
) -> int | None:
    """Free slot-aligned start in ``[lower, fit_end - duration]`` closest to
    ``target_ms`` (ties -> earlier); ``None`` when nothing fits."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    first = ceil_to_slot(lower_ms)
    if first + duration_ms > fit_end_ms:
        return None
    n = (fit_end_ms - duration_ms - first) // SLOT_MS + 1
    free = np.flatnonzero(free_start_mask(first, n, duration_ms, occupied))
    starts = first + free.astype(np.int64) * SLOT_MS
    if starts.size == 0:
        return None
    return int(starts[int(np.lexsort((starts, np.abs(starts - target_ms)))[0])])


def _without(intervals: Intervals, remove: Iterable[tuple[int, int]]) -> Intervals:
    """``intervals`` minus one instance of each ``remove`` item (multiset)."""
    left = Counter(remove)
    out: Intervals = []
    for iv in intervals:
        if left[iv] > 0:
            left[iv] -= 1
        else:
            out.append(iv)
    return out


def _cascade(
    candidate: tuple[int, int],
    obstacles: Intervals,
    participants: Sequence[FlexibleTask],
    lower_ms: int,
    horizon_end_ms: int,
    max_moves: int,
) -> list[DisplacementMove] | None:
    """Settle ``participants`` around ``candidate`` in EDF order.

    A participant still clear of everything settled so far stays put
    (stability). One that collides moves to the free start nearest its old
    one, anywhere in ``[lower, min(deadline, horizon_end)]``. It may land on a
    not-yet-settled participant with a strictly later deadline (which then
    gets its own turn), but never on a same-or-earlier-deadline peer -- so
    equal-priority tasks don't ripple-shift each other.
    """
    ordered = sorted(participants, key=lambda t: (t.deadline_ms, t.id))
    settled: Intervals = [*obstacles, candidate]
    moves: list[DisplacementMove] = []
    for i, p in enumerate(ordered):
        if not overlaps_any(settled, p.start_ms, p.end_ms):
            settled.append((p.start_ms, p.end_ms))
            continue
        peers = [
            (q.start_ms, q.end_ms)
            for q in ordered[i + 1 :]
            if q.deadline_ms <= p.deadline_ms
        ]
        slot = nearest_free_start(
            p.duration_minutes,
            [*settled, *peers],
            lower_ms,
            min(p.deadline_ms, horizon_end_ms),
            p.start_ms,
        )
        if slot is None:
            return None
        moves.append(DisplacementMove(p.id, p.start_ms, slot))
        if len(moves) > max_moves:
            return None
        settled.append((slot, slot + p.duration_minutes * MS_PER_MINUTE))
    return moves


def plan_displacement(
    task_duration_minutes: int,
    task_deadline_ms: int,
    flexible: Sequence[FlexibleTask],
    fixed: Intervals,
    now_ms: int,
    windows: Sequence[tuple[int, int]],
    horizon_occupied: Intervals,
    horizon_end_ms: int,
    max_moves: int | None = None,
) -> DisplacementPlan:
    """EDF displacement for a task with no free slot before its deadline.

    Per window: flexible tasks starting inside it (and not yet begun) are
    *participants*; everything else is an obstacle. The new task takes the
    earliest free-of-obstacles start whose :func:`_cascade` succeeds; moved
    participants may spill to any day up to their own deadline (bounded by
    ``horizon_end_ms``), avoiding ``horizon_occupied``. Fixed sessions never
    move.
    """
    max_moves = MAX_DISPLACED_TASKS if max_moves is None else max_moves
    duration_ms = task_duration_minutes * MS_PER_MINUTE
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
        global_obstacles: Intervals = [
            *fixed,
            *_without(horizon_occupied, ((p.start_ms, p.end_ms) for p in participants)),
            *obstacles,
        ]

        first = max(lower_ms, ceil_to_slot(win[0]))
        hi = min(win[1], task_deadline_ms - duration_ms + 1)  # exclusive
        if hi <= first:
            continue
        n = -((first - hi) // SLOT_MS)  # ceil((hi - first) / SLOT)
        free = np.flatnonzero(free_start_mask(first, n, duration_ms, obstacles))
        for s in (first + free * SLOT_MS).tolist():
            moves = _cascade(
                (s, s + duration_ms),
                global_obstacles,
                participants,
                lower_ms,
                horizon_end_ms,
                max_moves,
            )
            if moves is not None:
                return DisplacementPlan("placed", s, tuple(moves))
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


def last_resort_pin(
    duration_minutes: int,
    now_ms: int,
    deadline_ms: int,
    avoid: Intervals = (),
) -> int:
    """Terminal fallback: the latest on-grid start that still ends by the
    deadline, or the next slot when that is already past. Pushed later past
    anything in ``avoid`` (e.g. already-pinned siblings). Always returns a
    start -- a TASK is never left unplaced."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    s = max(ceil_to_slot(now_ms), floor_to_slot(deadline_ms - duration_ms))
    moved = True
    while moved:
        moved = False
        for o_start, o_end in avoid:
            if s < o_end and s + duration_ms > o_start:
                s = ceil_to_slot(o_end)
                moved = True
    return s


def flexible_from_dicts(raw: Sequence[dict[str, Any]]) -> list[FlexibleTask]:
    return [
        FlexibleTask(f["id"], f["durationMinutes"], f["deadlineMs"], f["startMs"])
        for f in raw
    ]
