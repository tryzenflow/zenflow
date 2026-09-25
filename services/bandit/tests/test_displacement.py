"""EDF displacement: an urgent task evicts late-deadline flexible tasks, which
spill to the nearest free slot before their own deadline (any day in the
horizon), never touching fixed sessions."""

from __future__ import annotations

from typing import Any

import pytest

from src.core.constants import DAY_MS
from tests.test_place import HOUR, NOW, make_days, make_req, ok

MIDNIGHT = NOW - 8 * HOUR  # Mon 2026-09-21 00:00 UTC


def _chill(prefix: str, start: int, end: int, deadline: int) -> list[dict[str, Any]]:
    """Back-to-back 4h flexible tasks covering [start, end)."""
    out = []
    s = start
    i = 0
    while s < end:
        out.append(
            {
                "id": f"{prefix}{i}",
                "durationMinutes": 240,
                "deadlineMs": deadline,
                "startMs": s,
            }
        )
        s += 4 * HOUR
        i += 1
    return out


def _body(
    flex: list[dict[str, Any]], fixed: list[tuple[int, int]], deadline: int
) -> dict[str, Any]:
    occ = [(f["startMs"], f["startMs"] + f["durationMinutes"] * 60_000) for f in flex]
    occ += fixed
    by_day: dict[int, list[tuple[int, int]]] = {}
    for a, b in occ:
        by_day.setdefault(int((a - MIDNIGHT) // DAY_MS), []).append((a, b))
    body = make_req(days=make_days(3, occupied=by_day), deadlineMs=deadline)
    body["infeasible"] = {
        "flexible": flex,
        "fixed": [{"startMs": a, "endMs": b} for a, b in fixed],
        "horizonOccupied": [{"startMs": a, "endMs": b} for a, b in occ],
    }
    return body


def test_urgent_task_evicts_chill_tasks_that_spill_to_a_later_day() -> None:
    """Today 08:00-24:00 and all of tomorrow are packed with tasks due in a
    week; day+2 is free. A 60m task due today 18:00 must still be placed."""
    week = NOW + 7 * DAY_MS
    flex = _chill("a", NOW, MIDNIGHT + DAY_MS, week) + _chill(
        "b", MIDNIGHT + DAY_MS, MIDNIGHT + 2 * DAY_MS, week
    )
    deadline = MIDNIGHT + 18 * HOUR
    r = ok(_body(flex, [], deadline))["results"][0]

    assert r["outcome"] == "DISPLACED"
    assert r["startMs"] == NOW  # earliest feasible
    assert r["startMs"] + HOUR <= deadline
    by_id = {f["id"]: f for f in flex}
    assert [m["id"] for m in r["moves"]] == ["a0"]
    (mv,) = r["moves"]
    # nearest free slot to its old start: day+2 00:00 (everything before is packed)
    assert mv["toMs"] == MIDNIGHT + 2 * DAY_MS
    assert mv["toMs"] + by_id["a0"]["durationMinutes"] * 60_000 <= week


# ---- core planner -------------------------------------------------------

from src.core.arms import ARM_BANDS, seeded_tie_break_order  # noqa: E402
from src.core.displacement import (  # noqa: E402
    FlexibleTask,
    nearest_free_start,
    plan_displacement,
)
from src.core.linucb_best_slot import LinucbCandidateDay, best_linucb_slot  # noqa: E402
from src.core.slot_score import stability_weight  # noqa: E402

HORIZON_END = NOW + 40 * DAY_MS
TODAY = (MIDNIGHT, MIDNIGHT + DAY_MS)


def _plan(
    flex: list[FlexibleTask],
    fixed: list[tuple[int, int]],
    deadline: int,
    dur: int = 60,
    horizon: list[tuple[int, int]] | None = None,
) -> Any:
    occ = [(f.start_ms, f.end_ms) for f in flex] + fixed
    return plan_displacement(
        dur,
        deadline,
        flex,
        fixed,
        NOW,
        [TODAY],
        occ if horizon is None else horizon,
        HORIZON_END,
    )


def test_fixed_sessions_never_move_and_are_never_overlapped() -> None:
    fixed = [(NOW, NOW + 2 * HOUR)]  # lecture 08-10
    flex = [FlexibleTask("c", 120, NOW + 7 * DAY_MS, NOW + 2 * HOUR)]  # 10-12
    plan = _plan(flex, fixed, MIDNIGHT + 12 * HOUR)
    assert plan.kind == "placed"
    assert plan.start_ms == NOW + 2 * HOUR  # earliest start clear of the lecture
    assert [m.id for m in plan.moves] == ["c"]
    s, e = plan.start_ms, plan.start_ms + HOUR
    assert not any(s < b and e > a for a, b in fixed)
    # the chill task lands right after the new one (nearest to 10:00, not 08-10)
    assert plan.moves[0].to_ms == NOW + 3 * HOUR


def test_edf_earlier_deadline_keeps_the_closer_slot() -> None:
    """Both tasks collide with the urgent one; the tighter-deadline task is
    settled first and takes the slot nearest its old start."""
    wall = [(NOW + 4 * HOUR, MIDNIGHT + DAY_MS)]  # 12:00-24:00 blocked (fixed)
    flex = [
        FlexibleTask("late", 60, NOW + 7 * DAY_MS, NOW),  # 08-09
        FlexibleTask("soon", 60, NOW + 2 * DAY_MS, NOW + HOUR),  # 09-10
    ]
    plan = _plan(flex, wall, MIDNIGHT + 12 * HOUR, dur=120)  # needs 08-10
    assert plan.kind == "placed" and plan.start_ms == NOW
    to = {m.id: m.to_ms for m in plan.moves}
    assert to["soon"] == NOW + 2 * HOUR  # 10:00 -- nearest free
    assert to["late"] == NOW + 3 * HOUR  # 11:00 -- what's left
    for m in plan.moves:
        f = next(x for x in flex if x.id == m.id)
        assert m.to_ms + f.duration_minutes * 60_000 <= f.deadline_ms


def test_moved_task_respects_its_own_deadline() -> None:
    """The only room left is after the chill task's deadline -> infeasible."""
    flex = [FlexibleTask("c", 240, MIDNIGHT + DAY_MS, NOW)]  # 08-12, due tonight
    wall = [(NOW + 4 * HOUR, MIDNIGHT + DAY_MS)]
    assert _plan(flex, wall, MIDNIGHT + 12 * HOUR, dur=240).kind == "infeasible"


def test_equal_deadline_peers_do_not_ripple() -> None:
    """Four back-to-back peers + free evening: only the one in the way moves,
    to the evening, instead of shifting all four by an hour."""
    week = NOW + 7 * DAY_MS
    flex = [FlexibleTask(f"p{i}", 120, week, NOW + 2 * i * HOUR) for i in range(4)]
    plan = _plan(flex, [], MIDNIGHT + 10 * HOUR)
    assert plan.kind == "placed" and plan.start_ms == NOW
    assert [(m.id, m.to_ms) for m in plan.moves] == [("p0", NOW + 8 * HOUR)]


def test_nearest_free_start_ties_go_earlier() -> None:
    occ = [(NOW, NOW + HOUR)]
    got = nearest_free_start(60, occ, NOW - HOUR, NOW + 3 * HOUR, NOW)
    assert got == NOW - HOUR  # 07:00 and 09:00 are both 1h away


# ---- stability proximity ------------------------------------------------


def test_stability_weight_fades_with_lead_time() -> None:
    assert stability_weight(NOW - 5 * HOUR, NOW) == 1.0
    assert stability_weight(NOW, NOW) == 1.0
    assert stability_weight(NOW + 24 * HOUR, NOW) == 1.0
    assert stability_weight(NOW + 96 * HOUR, NOW) == pytest.approx(0.525)
    assert stability_weight(NOW + 168 * HOUR, NOW) == pytest.approx(0.05)
    assert stability_weight(NOW + 400 * HOUR, NOW) == pytest.approx(0.05)


def _one_day(day_start: int, scores: dict[str, float]) -> LinucbCandidateDay:
    return LinucbCandidateDay("d", day_start, day_start + DAY_MS, [], [0.0], scores)


def test_near_task_stays_far_task_follows_linucb() -> None:
    """EVENING scores 0.3 above AFTERNOON. A task at 14:00 two hours out
    stays put (w=1 beats 0.3); the same slot ten days out moves to evening."""
    scores = {a: 0.0 for a, *_ in ARM_BANDS} | {"AFTERNOON": 0.5, "EVENING": 0.8}

    near_prev = MIDNIGHT + 14 * HOUR
    near = best_linucb_slot(
        [_one_day(MIDNIGHT, scores)],
        60,
        "UTC",
        NOW,
        NOW + DAY_MS,
        prev_start_ms=near_prev,
    )
    assert near is not None and near.start_ms == near_prev
    assert near.stability_weight == 1.0

    far_day = MIDNIGHT + 10 * DAY_MS
    far = best_linucb_slot(
        [_one_day(far_day, scores)],
        60,
        "UTC",
        NOW,
        far_day + DAY_MS,
        prev_start_ms=far_day + 14 * HOUR,
    )
    assert far is not None and far.arm == "EVENING"
    assert far.stability_weight == pytest.approx(0.05)


def test_preference_matrix_never_changes_the_linucb_pick() -> None:
    """LinUCB ignores the preference matrix entirely (independent A/B arm):
    flipping it changes neither the band, the score nor the start."""
    cold: dict[str, dict[str, list[float]]] = {
        a: {"A": [], "b": []} for a, *_ in ARM_BANDS
    }
    base = make_req(
        members=[
            {
                "id": "t1",
                "durationMinutes": 60,
                "primaryPolicy": "LINUCB",
                "computeBoth": False,
            }
        ],
        bandit={"alpha": 0.15, "ridge": 1.0, "state": cold},
    )
    flipped = make_req(**{k: v for k, v in base.items() if k != "user"})
    flipped["user"] = {"preferenceMatrix": [-1.0] * 168, "observationCount": 0}
    a = ok(base)["results"][0]["linucb"]
    b = ok(flipped)["results"][0]["linucb"]
    assert (a["selectedArm"], a["score"], a["startMs"]) == (
        b["selectedArm"],
        b["score"],
        b["startMs"],
    )


@pytest.mark.parametrize(
    ("arm", "dur", "want_start_min"),
    [
        ("MORNING", 60, 8 * 60),  # [06:00, 11:00) centre 08:30 -> 08:00-09:00
        ("MIDDAY", 60, 12 * 60),  # [11:00, 14:00) centre 12:30
        ("AFTERNOON", 60, 15 * 60),  # [14:00, 17:00) centre 15:30
        ("EVENING", 90, 17 * 60 + 45),  # [17:00, 20:00) centre 18:30
        ("NIGHT", 120, 21 * 60),  # [20:00, 24:00) centre 22:00
    ],
)
def test_winning_band_places_the_task_at_its_centre(
    arm: str, dur: int, want_start_min: int
) -> None:
    """Inside the winning band the arm term is flat; the fixed tie-break centres
    the task in the band instead of its first minute (e.g. 06:00)."""
    scores = {a: 0.0 for a, *_ in ARM_BANDS} | {arm: 0.5}
    day = MIDNIGHT + DAY_MS
    pick = best_linucb_slot([_one_day(day, scores)], dur, "UTC", NOW, day + DAY_MS)
    assert pick is not None and pick.arm == arm
    assert pick.start_ms == day + want_start_min * 60_000


# ---- cold-start tie-break -----------------------------------------------


def test_cold_tie_break_is_deterministic_and_spreads_over_waking_bands() -> None:
    cold = {a: 0.0 for a, *_ in ARM_BANDS}
    day = MIDNIGHT + DAY_MS
    arms = set()
    for i in range(200):
        order = seeded_tie_break_order(f"req-{i}|t1")
        assert order[-1] == "EARLY_MORNING"
        picks = [
            best_linucb_slot(
                [_one_day(day, cold)],
                60,
                "UTC",
                NOW,
                day + DAY_MS,
                tie_break_order=seeded_tie_break_order(f"req-{i}|t1"),
            )
            for _ in range(2)
        ]
        assert picks[0] is not None and picks[1] is not None
        assert (picks[0].start_ms, picks[0].arm) == (picks[1].start_ms, picks[1].arm)
        assert picks[0].arm == order[0]
        arms.add(picks[0].arm)
    assert arms == {"MORNING", "MIDDAY", "AFTERNOON", "EVENING", "NIGHT"}
