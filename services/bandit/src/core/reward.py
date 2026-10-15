"""Delayed rewards: graded MOVE (port of ``reward.ts``) and completion (ADR-0023)."""

from .constants import (
    CHECK_OFF_GRACE_MS,
    COMPLETED_REWARD,
    MISS_CUTOFF_MS,
    MISSED_REWARD,
    MOVE_REWARD_SCALE_MINUTES,
)


def drag_distance_reward(
    drag_distance_minutes: float,
    scale_minutes: float = MOVE_REWARD_SCALE_MINUTES,
) -> float:
    if drag_distance_minutes == 0:
        return 0.0
    return -min(1.0, abs(drag_distance_minutes) / scale_minutes)


def completion_reward(
    start_ms: int,
    end_ms: int,
    completed_at_ms: int | None,
    skipped: bool,
    now_ms: int,
    grace_ms: int = CHECK_OFF_GRACE_MS,
    cutoff_ms: int = MISS_CUTOFF_MS,
) -> float | None:
    """Reward of an unmoved placement, or ``None`` while it is not settled.

    Settles at ``end + grace`` for a check-off inside the slot (``+1``) or a
    skip (``-1``). A check-off before ``start`` does not count, so it settles as
    missed (``-1``) at ``end + cutoff``, as does a placement with no check-off.
    """
    if now_ms < end_ms + grace_ms:
        return None
    if skipped:
        return MISSED_REWARD
    if completed_at_ms is not None and completed_at_ms >= start_ms:
        return COMPLETED_REWARD
    if now_ms >= end_ms + cutoff_ms:
        return MISSED_REWARD
    return None
