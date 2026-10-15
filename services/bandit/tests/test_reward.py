"""Completion reward (ADR-0022) and the graded MOVE reward."""

import pytest

from src.core.constants import CHECK_OFF_GRACE_MS, MISS_CUTOFF_MS
from src.core.reward import completion_reward, drag_distance_reward

MIN = 60_000
START = 10_000 * MIN
END = START + 60 * MIN
SETTLE = END + CHECK_OFF_GRACE_MS
CUTOFF = END + MISS_CUTOFF_MS


@pytest.mark.parametrize(
    ("drag", "expected"),
    [(0, 0.0), (120, -0.5), (-120, -0.5), (240, -1.0), (960, -1.0)],
)
def test_drag_distance_reward(drag: float, expected: float) -> None:
    assert drag_distance_reward(drag) == pytest.approx(expected)


def test_completed_in_slot_is_positive_at_settle() -> None:
    done = START + 5 * MIN
    assert completion_reward(START, END, done, False, SETTLE) == 1.0


def test_completed_in_slot_is_unsettled_before_grace() -> None:
    done = START + 5 * MIN
    assert completion_reward(START, END, done, False, SETTLE - 1) is None


def test_check_off_at_exact_start_counts() -> None:
    assert completion_reward(START, END, START, False, SETTLE) == 1.0


def test_check_off_before_start_does_not_count() -> None:
    early = START - MIN
    assert completion_reward(START, END, early, False, SETTLE) is None
    assert completion_reward(START, END, early, False, CUTOFF) == -1.0


def test_skip_is_negative_at_settle() -> None:
    assert completion_reward(START, END, None, True, SETTLE) == -1.0


def test_skip_wins_over_completed_timestamp() -> None:
    done = START + MIN
    assert completion_reward(START, END, done, True, SETTLE) == -1.0


def test_no_check_off_is_unsettled_until_cutoff() -> None:
    assert completion_reward(START, END, None, False, SETTLE) is None
    assert completion_reward(START, END, None, False, CUTOFF - 1) is None


def test_no_check_off_by_cutoff_is_missed() -> None:
    assert completion_reward(START, END, None, False, CUTOFF) == -1.0


def test_not_elapsed_is_unsettled_even_when_skipped() -> None:
    assert completion_reward(START, END, None, True, END) is None
