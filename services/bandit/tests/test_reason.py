"""Placement reason codes (issue #254): pure helpers, every branch, fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, get_args

import pytest

from src.core.constants import DAY_MS, MS_PER_MINUTE, SLOT_MS
from src.core.reason import (
    PlacementReason,
    count_free_starts,
    is_near_block,
    placement_reason,
)
from src.core.slot import local_midnight_ms
from src.place import place
from src.schemas_place import Outcome, PlaceRequest

ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = ROOT / "packages/shared/contract/place"

HOUR = 60 * MS_PER_MINUTE
DAY0 = local_midnight_ms("2026-09-21", "UTC")
NOW = DAY0 + 8 * HOUR  # Mon 08:00 UTC
ZERO_WL = {
    t: {"hours": 0, "count": 0}
    for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
}


def _request(
    *,
    dur: int = 60,
    deadline: int = NOW + 3 * DAY_MS,
    occupied: list[tuple[int, int]] | None = None,
    matrix: list[float] | None = None,
) -> PlaceRequest:
    day = {
        "dayStr": "2026-09-21",
        "dayStartMs": DAY0,
        "dayEndMs": DAY0 + DAY_MS,
        "occupied": [{"startMs": a, "endMs": b} for a, b in occupied or []],
        "workloadByType": ZERO_WL,
    }
    return PlaceRequest.model_validate(
        {
            "contractVersion": 3,
            "requestId": "reason-test",
            "mode": "PLACE",
            "nowMs": NOW,
            "timezone": "UTC",
            "deadlineMs": deadline,
            "maxScanDays": 30,
            "members": [
                {
                    "id": "t1",
                    "durationMinutes": dur,
                    "primaryPolicy": "HEURISTIC",
                    "computeBoth": False,
                }
            ],
            "fixedOccupied": [],
            "days": [day],
            "user": {"preferenceMatrix": matrix or [0.0] * 168, "observationCount": 0},
        }
    )


def _only(req: PlaceRequest) -> Any:
    return place(req).results[0]


@pytest.mark.parametrize("outcome", get_args(Outcome))
def test_every_outcome_returns_a_reason(outcome: str) -> None:
    codes = set(get_args(PlacementReason))
    for free, pref, near in [(0, 0.0, False), (1, 1.0, True), (5, 1.0, False)]:
        got = placement_reason(
            outcome, free_starts=free, preference=pref, near_class=near
        )
        assert got in codes, (outcome, got)


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"free_starts": 1, "preference": 1.0, "near_class": True}, "ONLY_FREE_SLOT"),
        ({"free_starts": 3, "preference": 0.5, "near_class": True}, "PREFERRED_HOUR"),
        ({"free_starts": 3, "preference": 0.49, "near_class": True}, "NEAR_CLASS"),
        (
            {"free_starts": 3, "preference": 0.0, "near_class": False},
            "BEFORE_DEADLINE",
        ),
    ],
)
def test_placed_rules_in_priority_order(kwargs: dict[str, Any], expected: str) -> None:
    assert placement_reason("PLACED", **kwargs) == expected


@pytest.mark.parametrize("outcome", ["DISPLACED", "NEEDS_CONFIRMATION"])
def test_moved_outcomes(outcome: str) -> None:
    got = placement_reason(outcome, free_starts=1, preference=1.0, near_class=True)
    assert got == "MOVED_FOR_DEADLINE"


@pytest.mark.parametrize(
    "outcome", ["ACCEPTED_CONFLICTS", "ACCEPTED_LATE", "ACCEPTED_LAST_RESORT"]
)
def test_accepted_outcomes_are_best_available(outcome: str) -> None:
    got = placement_reason(outcome, free_starts=1, preference=1.0, near_class=True)
    assert got == "BEST_AVAILABLE"


def test_count_free_starts_empty_day() -> None:
    end = DAY0 + DAY_MS
    n = count_free_starts([], NOW, end, end, HOUR)
    assert n == (end - HOUR - NOW) // SLOT_MS + 1


def test_count_free_starts_exact_fit_and_split() -> None:
    assert count_free_starts([], NOW, NOW + HOUR, NOW + HOUR, HOUR) == 1
    # A 15 min block at 08:30 splits the hour: no 60 min start fits.
    split = [(NOW + 30 * MS_PER_MINUTE, NOW + 45 * MS_PER_MINUTE)]
    assert count_free_starts(split, NOW, NOW + HOUR, NOW + HOUR, HOUR) == 0


def test_count_free_starts_ignores_blocks_before_window() -> None:
    before = [(NOW - 2 * HOUR, NOW - HOUR)]
    assert count_free_starts(before, NOW, NOW + HOUR, NOW + HOUR, HOUR) == 1


def test_is_near_block() -> None:
    block = [(10 * HOUR, 11 * HOUR)]
    assert not is_near_block(block, 8 * HOUR, HOUR)  # ends 09:00, 60 min clear
    assert is_near_block(block, 9 * HOUR, HOUR)  # ends 10:00, touches the block


def test_only_free_slot_placement() -> None:
    r = _only(_request(dur=60, deadline=NOW + HOUR))
    assert r.outcome == "PLACED"
    assert r.reason == "ONLY_FREE_SLOT"


def test_preferred_hour_placement() -> None:
    matrix = [0.0] * 168
    for wd in range(7):
        matrix[wd * 24 + 8] = 1.0
    r = _only(_request(matrix=matrix))
    assert r.outcome == "PLACED"
    assert r.reason == "PREFERRED_HOUR"


def test_before_deadline_placement() -> None:
    r = _only(_request())
    assert r.outcome == "PLACED"
    assert r.reason == "BEFORE_DEADLINE"


def test_near_class_placement() -> None:
    # Zero preference. A class 08:00 to 09:00 leaves 09:00 to 10:30 for a 60 min
    # task; the earliest start (09:00) touches the class.
    occupied = [(DAY0 + 8 * HOUR, DAY0 + 9 * HOUR)]
    r = _only(
        _request(
            dur=60, deadline=NOW + 2 * HOUR + 30 * MS_PER_MINUTE, occupied=occupied
        )
    )
    assert r.outcome == "PLACED"
    assert r.reason == "NEAR_CLASS"


def _fixture_results() -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        fx = json.loads(path.read_text("utf-8"))
        out.extend((f"{path.stem}/{r['id']}", r) for r in fx["response"]["results"])
    return out


@pytest.mark.parametrize(
    ("label", "result"),
    _fixture_results(),
    ids=lambda v: v if isinstance(v, str) else "result",
)
def test_every_fixture_placement_has_a_reason(
    label: str, result: dict[str, Any]
) -> None:
    assert (result["reason"] is None) == (result["startMs"] is None), label
    if result["reason"] is not None:
        assert result["reason"] in get_args(PlacementReason), label


def test_fixture_reasons_for_moved_and_last_resort() -> None:
    def reason_of(name: str) -> str | None:
        fx = json.loads((FIXTURE_DIR / f"{name}.json").read_text("utf-8"))
        reason: str | None = fx["response"]["results"][0]["reason"]
        return reason

    assert reason_of("single-displaced") == "MOVED_FOR_DEADLINE"
    assert reason_of("single-last-resort") == "BEST_AVAILABLE"
