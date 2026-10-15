"""Flexible-task displacement: cost-based cascade over anchored sessions.

Issue #62 B (EDF eviction with spillover) plus issue #250 (anchors, move cost,
confirmation for Chosen moves). See ADR-0022.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from numpy.typing import ArrayLike

from .constants import (
    DISPLACE_COST_AUTO,
    DISPLACE_COST_CHOSEN,
    DISPLACE_COST_CROSS_DAY,
    FROZEN_WINDOW_HOURS,
    HOUR_MS,
    MAX_DISPLACED_TASKS,
    MS_PER_MINUTE,
    SLOT_MS,
)
from .slot import (
    Intervals,
    add_days_str,
    ceil_to_slot,
    floor_to_slot,
    local_date_str,
    local_midnight_ms,
    overlaps_any,
)
from .slot_score import free_start_mask, slot_preference_scores

_TIE_DECIMALS = 9

Anchor = Literal["AUTO", "CHOSEN", "PINNED"]
ChosenMoves = Literal["ASK", "ALLOW", "FORBID"]
FROZEN_WINDOW_MS = FROZEN_WINDOW_HOURS * HOUR_MS


@dataclass(frozen=True)
class FlexibleTask:
    id: str
    duration_minutes: int
    deadline_ms: int
    start_ms: int
    anchor: Anchor = "AUTO"
    completed: bool = False
    series_id: str | None = None

    @property
    def end_ms(self) -> int:
        return self.start_ms + self.duration_minutes * MS_PER_MINUTE


@dataclass(frozen=True)
class DisplacementMove:
    id: str
    from_ms: int
    to_ms: int
    anchor: Anchor = "AUTO"
    cost: float = 0.0


@dataclass(frozen=True)
class DisplacementPlan:
    kind: str  # "placed" | "infeasible"
    start_ms: int | None = None
    moves: tuple[DisplacementMove, ...] = ()

    @property
    def cost(self) -> float:
        return sum(m.cost for m in self.moves)

    @property
    def moves_chosen(self) -> bool:
        return any(m.anchor == "CHOSEN" for m in self.moves)


def is_frozen(f: FlexibleTask, now_ms: int, frozen_ms: int = FROZEN_WINDOW_MS) -> bool:
    """Started, completed, or starting within ``frozen_ms`` of now."""
    return (
        f.completed
        or f.start_ms < now_ms + frozen_ms
        or f.start_ms < ceil_to_slot(now_ms)
    )


def is_movable(
    f: FlexibleTask,
    now_ms: int,
    chosen_moves: ChosenMoves = "ASK",
    frozen_ms: int = FROZEN_WINDOW_MS,
) -> bool:
    """Pinned and frozen never move; Chosen moves unless ``FORBID``."""
    if f.anchor == "PINNED" or is_frozen(f, now_ms, frozen_ms):
        return False
    return not (f.anchor == "CHOSEN" and chosen_moves == "FORBID")


def base_cost(anchor: Anchor) -> int:
    return DISPLACE_COST_CHOSEN if anchor == "CHOSEN" else DISPLACE_COST_AUTO


def _local_day_bounds(ms: int, timezone: str) -> tuple[int, int]:
    day = local_date_str(ms, timezone)
    return local_midnight_ms(day, timezone), local_midnight_ms(
        add_days_str(day, 1), timezone
    )


def move_cost(anchor: Anchor, from_ms: int, to_ms: int, timezone: str) -> float:
    """Base for the anchor, plus hours moved, plus the cross-day penalty."""
    ds, de = _local_day_bounds(from_ms, timezone)
    cross = 0 if ds <= to_ms < de else DISPLACE_COST_CROSS_DAY
    return base_cost(anchor) + abs(to_ms - from_ms) / HOUR_MS + cross


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


def cheapest_free_start(
    task: FlexibleTask,
    occupied: Intervals,
    lower_ms: int,
    fit_end_ms: int,
    timezone: str,
    blocked_days: Sequence[tuple[int, int]] = (),
) -> tuple[int, float] | None:
    """Free start for ``task`` with the lowest :func:`move_cost` (ties ->
    earlier), never starting inside a ``blocked_days`` interval."""
    duration_ms = task.duration_minutes * MS_PER_MINUTE
    first = ceil_to_slot(lower_ms)
    if first + duration_ms > fit_end_ms:
        return None
    n = (fit_end_ms - duration_ms - first) // SLOT_MS + 1
    starts = first + np.arange(n, dtype=np.int64) * SLOT_MS
    ok = free_start_mask(first, n, duration_ms, occupied)
    for ds, de in blocked_days:
        ok &= ~((starts >= ds) & (starts < de))
    starts = starts[ok]
    if starts.size == 0:
        return None
    ds, de = _local_day_bounds(task.start_ms, timezone)
    cost = (
        base_cost(task.anchor)
        + np.abs(starts - task.start_ms) / HOUR_MS
        + DISPLACE_COST_CROSS_DAY * ((starts < ds) | (starts >= de))
    )
    i = int(np.lexsort((starts, cost))[0])
    return int(starts[i]), float(cost[i])


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


def _sibling_days(
    task: FlexibleTask,
    series: Sequence[FlexibleTask],
    pos: dict[str, int],
    timezone: str,
) -> list[tuple[int, int]]:
    """Local days already holding another sitting of ``task``'s series."""
    return [
        _local_day_bounds(pos[q.id], timezone)
        for q in series
        if q.series_id == task.series_id and q.id != task.id
    ]


def _cascade(
    candidate: tuple[int, int],
    obstacles: Intervals,
    participants: Sequence[FlexibleTask],
    series: Sequence[FlexibleTask],
    lower_ms: int,
    horizon_end_ms: int,
    max_moves: int,
    timezone: str,
    protect_chosen: bool,
) -> list[DisplacementMove] | None:
    """Settle ``participants`` around ``candidate`` in EDF order.

    A participant still clear of everything settled stays put. One that
    collides moves to its cheapest free start in ``[lower, min(deadline,
    horizon_end)]``, never on a local day holding a sibling sitting. It may
    land on an unsettled participant with a strictly later deadline, which then
    gets its own turn; equal-deadline peers don't ripple-shift.

    ``protect_chosen`` settles Chosen participants first and lets them land
    only on free time, so a Chosen one moves only when the candidate itself
    needs its slot. Off, Chosen ones are plain EDF participants, so a cascade
    chain may run through them.
    """
    ordered = sorted(
        participants,
        key=lambda t: (protect_chosen and t.anchor != "CHOSEN", t.deadline_ms, t.id),
    )
    settled: Intervals = [*obstacles, candidate]
    pos = {f.id: f.start_ms for f in series}
    moves: list[DisplacementMove] = []
    for i, p in enumerate(ordered):
        if not overlaps_any(settled, p.start_ms, p.end_ms):
            settled.append((p.start_ms, p.end_ms))
            continue
        bumps_none = protect_chosen and p.anchor == "CHOSEN"
        peers = [
            (q.start_ms, q.end_ms)
            for q in ordered[i + 1 :]
            if bumps_none or q.deadline_ms <= p.deadline_ms
        ]
        blocked = (
            _sibling_days(p, series, pos, timezone) if p.series_id is not None else []
        )
        hit = cheapest_free_start(
            p,
            [*settled, *peers],
            lower_ms,
            min(p.deadline_ms, horizon_end_ms),
            timezone,
            blocked,
        )
        if hit is None:
            return None
        slot, cost = hit
        moves.append(DisplacementMove(p.id, p.start_ms, slot, p.anchor, cost))
        if len(moves) > max_moves:
            return None
        settled.append((slot, slot + p.duration_minutes * MS_PER_MINUTE))
        pos[p.id] = slot
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
    *,
    timezone: str = "UTC",
    chosen_moves: ChosenMoves = "ASK",
    frozen_ms: int = FROZEN_WINDOW_MS,
) -> DisplacementPlan:
    """Cheapest cascade for a task with no free slot before its deadline.

    Per window: movable flexible tasks (:func:`is_movable`) overlapping it are
    *participants*; fixed, Pinned, frozen and out-of-window tasks are
    obstacles. Every obstacle-free start before the deadline is tried with
    :func:`_cascade`, Chosen-protected and, when a Chosen participant exists,
    plain EDF too. The lowest total move cost wins (ties -> earlier window,
    earlier start, then the Chosen-protected cascade). Moved participants may
    spill to any day up to their own deadline (bounded by ``horizon_end_ms``),
    avoiding ``horizon_occupied``. The caller decides whether a plan moving a
    Chosen session needs confirmation (:attr:`DisplacementPlan.moves_chosen`).
    """
    max_moves = MAX_DISPLACED_TASKS if max_moves is None else max_moves
    duration_ms = task_duration_minutes * MS_PER_MINUTE
    lower_ms = ceil_to_slot(now_ms)
    movable = [f for f in flexible if is_movable(f, now_ms, chosen_moves, frozen_ms)]
    series = [f for f in flexible if f.series_id is not None]

    best = DisplacementPlan("infeasible")
    best_cost = float("inf")
    for win in windows:
        participants = [f for f in movable if f.end_ms > win[0] and f.start_ms < win[1]]
        p_ids = {p.id for p in participants}
        has_chosen = any(p.anchor == "CHOSEN" for p in participants)
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
            # Lower bound: every participant under the candidate must move.
            floor = sum(
                base_cost(p.anchor)
                for p in participants
                if p.start_ms < s + duration_ms and p.end_ms > s
            )
            if floor >= best_cost:
                continue
            for protect in (True, False) if has_chosen else (True,):
                moves = _cascade(
                    (s, s + duration_ms),
                    global_obstacles,
                    participants,
                    series,
                    lower_ms,
                    horizon_end_ms,
                    max_moves,
                    timezone,
                    protect,
                )
                if moves is None:
                    continue
                cost = sum(m.cost for m in moves)
                if cost < best_cost:
                    best = DisplacementPlan("placed", s, tuple(moves))
                    best_cost = cost
    return best


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
    avoid: Sequence[tuple[int, int]] = (),
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
        FlexibleTask(
            f["id"],
            f["durationMinutes"],
            f["deadlineMs"],
            f["startMs"],
            f.get("anchor", "AUTO"),
            f.get("completed", False),
            f.get("seriesId"),
        )
        for f in raw
    ]
