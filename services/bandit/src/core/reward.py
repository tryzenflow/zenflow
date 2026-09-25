"""Graded MOVE reward (port of ``reward.ts``)."""

from .constants import MOVE_REWARD_SCALE_MINUTES


def drag_distance_reward(
    drag_distance_minutes: float,
    scale_minutes: float = MOVE_REWARD_SCALE_MINUTES,
) -> float:
    if drag_distance_minutes == 0:
        return 0.0
    return -min(1.0, abs(drag_distance_minutes) / scale_minutes)
