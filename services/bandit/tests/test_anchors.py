"""Anchors and cost-based displacement (issue #250, ADR-0022).

Edge cases: Chosen confirmation, Pinned blocking, frozen by time, cascade
chains, cross-day cost, deadlines, multi-sitting series, ties and
determinism, no feasible plan, and the wire defaults.
"""

from __future__ import annotations

import random
from typing import Any

import pytest

from src.core.constants import DAY_MS
from src.core.displacement import (
    FlexibleTask,
    cheapest_free_start,
    move_cost,
    plan_displacement,
)
from src.core.slot import ceil_to_slot
from tests.test_place import HOUR, NOW, make_days, make_req, member, ok, post

MIDNIGHT = NOW - 8 * HOUR  # Mon 2026-09-21 00:00 UTC, NOW is 08:00
WEEK = NOW + 7 * DAY_MS
MIN = 60_000


def at(hours: float, day: int = 0) -> int:
    return MIDNIGHT + day * DAY_MS + int(hours * HOUR)


def fx(
    fid: str,
    start: int,
    minutes: int = 60,
    deadline: int = WEEK,
    anchor: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": fid,
        "durationMinutes": minutes,
        "deadlineMs": deadline,
        "startMs": start,
        **extra,
    }
    if anchor is not None:
        out["anchor"] = anchor
    return out


def _split_by_day(
    ivs: list[tuple[int, int]], n: int
) -> dict[int, list[tuple[int, int]]]:
    out: dict[int, list[tuple[int, int]]] = {}
    for a, b in ivs:
        for i in range(n):
            ds, de = MIDNIGHT + i * DAY_MS, MIDNIGHT + (i + 1) * DAY_MS
            if a < de and b > ds:
                out.setdefault(i, []).append((max(a, ds), min(b, de)))
    return out


def body(
    flex: list[dict[str, Any]],
    fixed: list[tuple[int, int]],
    deadline: int,
    dur: int = 60,
    chosen: str | None = None,
    policy: str | None = None,
) -> dict[str, Any]:
    occ = [(f["startMs"], f["startMs"] + f["durationMinutes"] * MIN) for f in flex]
    occ += fixed
    ctx: dict[str, Any] = {
        "flexible": flex,
        "fixed": [{"startMs": a, "endMs": b} for a, b in fixed],
        "horizonOccupied": [{"startMs": a, "endMs": b} for a, b in occ],
    }
    if chosen is not None:
        ctx["chosenMoves"] = chosen
    if policy is not None:
        ctx["policy"] = policy
    return make_req(
        requestId="anchors-2",
        days=make_days(3, occupied=_split_by_day(occ, 3)),
        deadlineMs=deadline,
        members=[member(dur=dur)],
        infeasible=ctx,
    )


def result(b: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = ok(b)["results"][0]
    return out


def moves(r: dict[str, Any]) -> list[tuple[str, int, int, str, float]]:
    return [
        (m["id"], m["fromMs"], m["toMs"], m["anchor"], m["cost"]) for m in r["moves"]
    ]


LECTURE = (at(8), at(10))  # fixed, also covers the frozen window


# ---- Chosen needs confirmation ------------------------------------------


def _two_hour_squeeze(chosen: str | None) -> dict[str, Any]:
    """A 120 min task due 12:00: Chosen C (10-11) and Auto A (11-12) both move.
    12:00-14:00 is free, then a wall until day+2."""
    flex = [fx("c", at(10), anchor="CHOSEN"), fx("a", at(11), anchor="AUTO")]
    wall = (at(14), at(0, day=2))
    return body(flex, [LECTURE, wall], at(12), dur=120, chosen=chosen)


def test_chosen_move_needs_confirmation_with_the_full_plan() -> None:
    r = result(_two_hour_squeeze(None))
    assert r["outcome"] == "NEEDS_CONFIRMATION"
    assert r["startMs"] == at(10) and r["appliedPolicy"] == "HEURISTIC"
    assert moves(r) == [
        ("c", at(10), at(12), "CHOSEN", 10 + 2),
        ("a", at(11), at(13), "AUTO", 1 + 2),
    ]


def test_allow_returns_the_same_plan_as_displaced() -> None:
    ask = result(_two_hour_squeeze("ASK"))
    allow = result(_two_hour_squeeze("ALLOW"))
    assert allow["outcome"] == "DISPLACED"
    assert (allow["startMs"], allow["moves"]) == (ask["startMs"], ask["moves"])


def test_forbid_keeps_chosen_put_and_falls_back() -> None:
    r = result(_two_hour_squeeze("FORBID"))
    assert r["outcome"] == "ACCEPTED_LAST_RESORT" and r["moves"] == []


def test_cheaper_auto_plan_leaves_chosen_alone() -> None:
    """Moving A to 12:00 costs 2; moving C costs 12. No confirmation needed."""
    flex = [fx("c", at(10), anchor="CHOSEN"), fx("a", at(11))]
    r = result(body(flex, [LECTURE, (at(13), at(0, day=2))], at(12)))
    assert r["outcome"] == "DISPLACED" and r["startMs"] == at(11)
    assert moves(r) == [("a", at(11), at(12), "AUTO", 2)]


def _chosen_vs_far_auto(chosen: str | None) -> dict[str, Any]:
    """C (10-11, Chosen) can shift to the 13:30 gap for 13.5; the 2 h Auto A
    (11-13, Pinned P right after) only fits on day+2, for 1 + 37 + 10 = 48."""
    flex = [
        fx("c", at(10), anchor="CHOSEN"),
        fx("a", at(11), minutes=120),
        fx("p", at(13), minutes=30, anchor="PINNED"),
    ]
    return body(flex, [LECTURE, (at(14.5), at(0, day=2))], at(12), chosen=chosen)


def test_cost_picks_the_chosen_move_over_a_far_auto_move() -> None:
    r = result(_chosen_vs_far_auto(None))
    assert r["outcome"] == "NEEDS_CONFIRMATION" and r["startMs"] == at(10)
    assert moves(r) == [("c", at(10), at(13.5), "CHOSEN", 13.5)]


def test_forbid_takes_the_dearer_auto_only_plan() -> None:
    r = result(_chosen_vs_far_auto("FORBID"))
    assert r["outcome"] == "DISPLACED" and r["startMs"] == at(11)
    assert moves(r) == [("a", at(11), at(0, day=2), "AUTO", 48)]


# ---- Pinned and fixed ----------------------------------------------------


def test_pinned_blocks_and_never_moves() -> None:
    """P (Pinned, 11-12) sits next to Chosen C: only C can make room."""
    flex = [fx("c", at(10), anchor="CHOSEN"), fx("p", at(11), anchor="PINNED")]
    r = result(body(flex, [LECTURE, (at(13), at(0, day=2))], at(12)))
    assert r["outcome"] == "NEEDS_CONFIRMATION"
    assert moves(r) == [("c", at(10), at(12), "CHOSEN", 12)]


def test_pinned_alone_in_the_way_is_infeasible() -> None:
    flex = [fx("p", at(10), minutes=120, anchor="PINNED")]
    r = result(body(flex, [LECTURE], at(12)))
    assert r["outcome"] == "ACCEPTED_LAST_RESORT" and r["moves"] == []
    assert r["conflicting"] is True


# ---- frozen by time ------------------------------------------------------


@pytest.mark.parametrize(
    ("start", "extra", "frozen"),
    [
        (at(9.75), {}, True),  # starts within 2 h of now
        (at(10), {}, False),  # exactly 2 h out: movable
        (at(10), {"completed": True}, True),
        (at(10), {"anchor": "CHOSEN", "completed": True}, True),
    ],
)
def test_frozen_sessions_never_move(
    start: int, extra: dict[str, Any], frozen: bool
) -> None:
    flex = [fx("f", start, **extra)]
    r = result(body(flex, [(at(8), start)], start + HOUR))
    if frozen:
        assert r["outcome"] == "ACCEPTED_LAST_RESORT" and r["moves"] == []
    else:
        assert r["outcome"] == "DISPLACED"
        assert moves(r) == [("f", start, start + HOUR, "AUTO", 2)]


def test_started_session_is_frozen() -> None:
    plan = plan_displacement(
        60,
        at(9),
        [FlexibleTask("s", 90, WEEK, at(7.5))],
        [],
        NOW,
        [(MIDNIGHT, MIDNIGHT + DAY_MS)],
        [(at(7.5), at(9))],
        WEEK,
        frozen_ms=0,
    )
    assert plan.kind == "infeasible"


# ---- cascade chains -------------------------------------------------------


def _chain(anchor: str) -> dict[str, Any]:
    """E (due 12:00) must leave 10-11 and can only go to 11:00, over L."""
    flex = [fx("e", at(10), deadline=at(12)), fx("l", at(11), anchor=anchor)]
    return body(flex, [LECTURE, (at(13), at(0, day=2))], at(11))


def test_cascade_chain_through_autos() -> None:
    r = result(_chain("AUTO"))
    assert r["outcome"] == "DISPLACED" and r["startMs"] == at(10)
    assert moves(r) == [
        ("e", at(10), at(11), "AUTO", 2),
        ("l", at(11), at(12), "AUTO", 2),
    ]


def test_cascade_chain_through_chosen_needs_confirmation() -> None:
    r = result(_chain("CHOSEN"))
    assert r["outcome"] == "NEEDS_CONFIRMATION"
    assert moves(r) == [
        ("e", at(10), at(11), "AUTO", 2),
        ("l", at(11), at(12), "CHOSEN", 11),
    ]


def test_cascade_chain_stops_at_pinned() -> None:
    r = result(_chain("PINNED"))
    assert r["outcome"] == "ACCEPTED_LAST_RESORT" and r["moves"] == []


def test_move_cap_bounds_the_chain() -> None:
    flex = [FlexibleTask(f"t{i}", 15, WEEK, at(10) + i * 15 * MIN) for i in range(4)]
    occ = [LECTURE, *((f.start_ms, f.end_ms) for f in flex)]
    window = [(MIDNIGHT, MIDNIGHT + DAY_MS)]
    args = (60, at(11), flex, [LECTURE], NOW, window, occ, WEEK)
    assert plan_displacement(*args, max_moves=4).kind == "placed"
    assert plan_displacement(*args, max_moves=3).kind == "infeasible"


# ---- cost and cross-day ----------------------------------------------------


def test_move_cost_formula() -> None:
    assert move_cost("AUTO", at(10), at(12), "UTC") == 1 + 2
    assert move_cost("CHOSEN", at(10), at(9.75), "UTC") == 10 + 0.25
    assert move_cost("AUTO", at(23), at(1, day=1), "UTC") == 1 + 2 + 10
    assert move_cost("CHOSEN", at(10), at(10, day=1), "UTC") == 10 + 24 + 10


def test_cross_day_uses_the_local_day() -> None:
    """16:00 -> 18:00 UTC stays on one UTC day but crosses midnight in Saigon."""
    assert move_cost("AUTO", at(16), at(18), "UTC") == 3
    assert move_cost("AUTO", at(16), at(18), "Asia/Ho_Chi_Minh") == 13


def test_relocation_prefers_a_farther_same_day_slot_over_a_closer_other_day() -> None:
    """Task at day1 01:00. Free: day0 22:00 (3 h back, other day: 14) and
    day1 06:00 (5 h on, same day: 6)."""
    task = FlexibleTask("t", 60, WEEK, at(1, day=1))
    occ = [(at(20), at(22)), (at(23), at(6, day=1)), (at(7, day=1), at(23, day=1))]
    assert cheapest_free_start(task, occ, at(20), at(23, day=1), "UTC") == (
        at(6, day=1),
        6,
    )


def test_relocation_ties_go_earlier() -> None:
    task = FlexibleTask("t", 60, WEEK, at(11))
    occ = [(at(8), at(10)), (at(11), at(12)), (at(13), at(20))]
    assert cheapest_free_start(task, occ, at(8), at(20), "UTC") == (at(10), 2)


# ---- deadlines --------------------------------------------------------------


def test_participant_never_moves_past_its_own_deadline() -> None:
    """The only free time is after A's deadline: no plan."""
    flex = [fx("a", at(10), deadline=at(11))]
    r = result(body(flex, [LECTURE, (at(11), at(13))], at(11)))
    assert r["outcome"] == "ACCEPTED_LAST_RESORT" and r["moves"] == []


def test_overdue_participant_is_stuck() -> None:
    flex = [fx("a", at(10), deadline=at(9))]
    r = result(body(flex, [LECTURE], at(11)))
    assert r["moves"] == []


# ---- multi-sitting series ---------------------------------------------------


@pytest.mark.parametrize(("series", "lands"), [(None, 1), ("s", 2)])
def test_sitting_never_lands_on_a_sibling_day(series: str | None, lands: int) -> None:
    """S1 (today 10-11) must move; day+1 is free but holds sibling S2."""
    extra = {} if series is None else {"seriesId": series}
    flex = [fx("s1", at(10), **extra), fx("s2", at(10, day=1), **extra)]
    r = result(body(flex, [LECTURE, (at(11), at(0, day=1))], at(11)))
    assert r["outcome"] == "DISPLACED"
    assert [(m["id"], m["toMs"]) for m in r["moves"]] == [("s1", at(0, day=lands))]


def test_series_request_is_never_displaced() -> None:
    flex = [fx("a", at(10), minutes=120)]
    b = body(flex, [LECTURE, (at(12), at(0, day=3))], at(12))
    b["members"] = [member("m1"), member("m2")]
    out = ok(b)["results"]
    assert {r["outcome"] for r in out} == {"ACCEPTED_LAST_RESORT"}
    assert all(r["moves"] == [] for r in out)


# ---- ties and determinism ---------------------------------------------------


def _tie_body() -> dict[str, Any]:
    """Every candidate 10:00..11:00 sends the 2 h task A past Z to day+2 02:00."""
    flex = [fx("a", at(10), minutes=120), fx("z", at(1, day=2))]
    return body(flex, [LECTURE, (at(12), at(0, day=2))], at(12))


def test_equal_cost_plans_take_the_earliest_start() -> None:
    r = result(_tie_body())
    assert r["startMs"] == at(10)
    assert moves(r) == [("a", at(10), at(2, day=2), "AUTO", 1 + 40 + 10)]


def test_same_input_same_plan_whatever_the_order() -> None:
    b = _tie_body()
    first = result(b)
    b["infeasible"]["flexible"].reverse()
    b["infeasible"]["horizonOccupied"].reverse()
    assert result(b) == first
    assert result(b) == first


# ---- no feasible plan -------------------------------------------------------


@pytest.mark.parametrize("anchor", ["AUTO", "CHOSEN"])
def test_no_feasible_plan_uses_the_fallback_policy(anchor: str) -> None:
    """A is due 11:00 and can't go anywhere: never a confirmation prompt."""
    flex = [fx("a", at(10), deadline=at(11), anchor=anchor)]
    r = result(body(flex, [LECTURE], at(11), policy="ACCEPT_CONFLICTS"))
    assert r["outcome"] == "ACCEPTED_CONFLICTS" and r["moves"] == []


# ---- wire -------------------------------------------------------------------


def test_anchor_defaults_to_auto() -> None:
    flex = [fx("a", at(10))]
    assert "anchor" not in flex[0]
    r = result(body(flex, [LECTURE], at(11)))
    assert r["outcome"] == "DISPLACED" and r["moves"][0]["anchor"] == "AUTO"


@pytest.mark.parametrize(
    ("path", "value"),
    [(("flexible", 0, "anchor"), "FIXED"), (("chosenMoves",), "MAYBE")],
)
def test_unknown_anchor_values_are_rejected(path: tuple[Any, ...], value: str) -> None:
    b = body([fx("a", at(10))], [LECTURE], at(11))
    node: Any = b["infeasible"]
    for k in path[:-1]:
        node = node[k]
    node[path[-1]] = value
    assert post(b).status_code == 422


def test_old_contract_version_is_refused() -> None:
    b = body([fx("a", at(10))], [LECTURE], at(11))
    b["contractVersion"] = 1
    r = post(b)
    assert r.status_code == 422 and r.json()["code"] == "CONTRACT_VERSION"


# ---- invariants over generated calendars ------------------------------------


def _random_body(seed: int, chosen: str) -> dict[str, Any]:
    rng = random.Random(seed)
    anchors = ["AUTO", "AUTO", "CHOSEN", "PINNED"]
    flex: list[dict[str, Any]] = []
    t0 = t = at(rng.choice([9, 9.5, 10]))
    for i in range(rng.randint(3, 7)):
        minutes = rng.choice([30, 60, 90, 120])
        deadline = rng.choice([at(14), at(20), at(12, day=1), WEEK])
        flex.append(
            fx(
                f"f{i}",
                t,
                minutes,
                deadline,
                rng.choice(anchors),
                **({"completed": True} if rng.random() < 0.1 else {}),
            )
        )
        t += minutes * MIN + rng.choice([0, 0, 0, 15]) * MIN
    walls = [(at(8), t0), (t, t + rng.choice([2, 6, 20]) * HOUR)]
    deadline = rng.choice([at(11), at(12), at(14)])
    return body(flex, walls, deadline, rng.choice([30, 60, 120]), chosen)


@pytest.mark.parametrize("chosen", ["ASK", "ALLOW", "FORBID"])
@pytest.mark.parametrize("seed", range(60))
def test_plan_invariants(seed: int, chosen: str) -> None:
    b = _random_body(seed, chosen)
    r = result(b)
    assert result(b) == r  # deterministic
    ctx = b["infeasible"]
    by_id = {f["id"]: f for f in ctx["flexible"]}
    moved = {m["id"]: m for m in r["moves"]}

    for fid, f in by_id.items():
        if fid not in moved:
            continue
        assert f.get("anchor", "AUTO") in ("AUTO", "CHOSEN")
        assert not f.get("completed", False)
        assert f["startMs"] >= NOW + 2 * HOUR
    has_chosen = any(m["anchor"] == "CHOSEN" for m in r["moves"])
    if chosen == "ASK":
        assert has_chosen == (r["outcome"] == "NEEDS_CONFIRMATION")
    else:
        assert r["outcome"] != "NEEDS_CONFIRMATION"
    if chosen == "FORBID":
        assert not has_chosen
    if r["outcome"] not in ("DISPLACED", "NEEDS_CONFIRMATION"):
        assert r["moves"] == []
        return

    dur = b["members"][0]["durationMinutes"] * MIN
    assert ceil_to_slot(NOW) <= r["startMs"] and r["startMs"] + dur <= b["deadlineMs"]
    placed = [(r["startMs"], r["startMs"] + dur)]
    for m in r["moves"]:
        f = by_id[m["id"]]
        assert m["fromMs"] == f["startMs"] and m["anchor"] == f.get("anchor", "AUTO")
        assert m["toMs"] % (15 * MIN) == 0 and m["toMs"] >= ceil_to_slot(NOW)
        end = m["toMs"] + f["durationMinutes"] * MIN
        assert end <= f["deadlineMs"]
        assert m["cost"] == move_cost(m["anchor"], m["fromMs"], m["toMs"], "UTC")
        placed.append((m["toMs"], end))
    staying = [(a["startMs"], a["endMs"]) for a in ctx["fixed"]] + [
        (f["startMs"], f["startMs"] + f["durationMinutes"] * MIN)
        for fid, f in by_id.items()
        if fid not in moved
    ]
    for i, (a, e) in enumerate(placed):
        assert not any(a < y and e > x for x, y in staying)
        assert not any(a < y and e > x for x, y in placed[i + 1 :])
