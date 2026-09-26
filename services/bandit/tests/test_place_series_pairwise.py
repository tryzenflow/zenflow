"""Pairwise-sampled series: two complete, independent plans (issue #58).

A series (``len(members) > 1``) whose members all set ``computeBoth`` with one
shared ``primaryPolicy`` gets a heuristic-only plan and a LinUCB plan, each
with its own sibling ledger (non-overlap + ``MAX_SERIES_PER_DAY``), over the
same batched ``(M, N, D)`` tensor. Every other request keeps the single
shared-ledger pass unchanged.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.core.constants import DAY_MS, MAX_SERIES_PER_DAY, MS_PER_MINUTE
from src.core.slot import local_date_str
from src.place import _Placer, _Timer
from src.schemas_place import PlacedMember, PlaceRequest
from tests.test_place_batch import NOW, bandit, make_days, make_req, warm_state

HOUR = 60 * MS_PER_MINUTE


def members(policy: str, durs: list[int], both: bool = True) -> list[dict[str, Any]]:
    return [
        {
            "id": f"s{i}",
            "durationMinutes": d,
            "primaryPolicy": policy,
            "computeBoth": both,
        }
        for i, d in enumerate(durs)
    ]


def run(req: PlaceRequest) -> list[PlacedMember]:
    return _Placer(req, _Timer()).run()


def single_pass(req: PlaceRequest) -> list[PlacedMember]:
    """The pre-#58 path: one shared ledger, per-member policy."""
    p = _Placer(req, _Timer())
    p._dual_plan_policy = lambda _batch: None  # type: ignore[method-assign, assignment]
    return p.run()


def with_members(req: PlaceRequest, ms: list[dict[str, Any]]) -> PlaceRequest:
    body = req.model_dump(by_alias=True)
    body["members"] = ms
    return PlaceRequest.model_validate(body)


def cross_midnight(policy: str) -> PlaceRequest:
    """4 sittings over 2 days: the LinUCB plan puts s0 at 23:45 (runs past
    midnight), so a shared ledger would push the heuristic pick for s1 off
    00:00 -- an independent heuristic plan doesn't see that sibling."""
    return make_req(
        members=members(policy, [120, 120, 60, 90]),
        deadlineMs=NOW + DAY_MS,
        days=make_days(2),
        maxScanDays=60,
        bandit=bandit(warm_state(3)),
    )


def spread(policy: str) -> PlaceRequest:
    return make_req(
        members=members(policy, [60, 90, 120, 60, 90]),
        deadlineMs=NOW + 6 * DAY_MS,
        days=make_days(
            7, occupied={2: [(NOW + 2 * DAY_MS, NOW + 2 * DAY_MS + 6 * HOUR)]}
        ),
        maxScanDays=60,
        bandit=bandit(warm_state(5)),
    )


SCENARIOS = [cross_midnight, spread]
POLICIES = ["HEURISTIC", "LINUCB"]


def heuristic_only(req: PlaceRequest) -> list[PlacedMember]:
    ms = [
        {
            "id": m.id,
            "durationMinutes": m.duration_minutes,
            "primaryPolicy": "HEURISTIC",
            "computeBoth": False,
        }
        for m in req.members
    ]
    return run(with_members(req, ms))


def linucb_only(req: PlaceRequest) -> list[PlacedMember]:
    ms = [
        {
            "id": m.id,
            "durationMinutes": m.duration_minutes,
            "primaryPolicy": "LINUCB",
            "computeBoth": False,
        }
        for m in req.members
    ]
    return run(with_members(req, ms))


# ---- the two plans ----------------------------------------------------------


@pytest.mark.parametrize("scenario", SCENARIOS)
@pytest.mark.parametrize("policy", POLICIES)
def test_fields_come_from_two_complete_independent_plans(
    scenario: Any, policy: str
) -> None:
    req = scenario(policy)
    got = run(req)
    heur, lin = heuristic_only(req), linucb_only(req)
    applied = heur if policy == "HEURISTIC" else lin
    for r, h, li, a in zip(got, heur, lin, applied, strict=True):
        assert r.heuristic == h.heuristic
        assert r.linucb == li.linucb
        assert (r.start_ms, r.outcome, r.applied_policy, r.late, r.conflicting) == (
            a.start_ms,
            a.outcome,
            a.applied_policy,
            a.late,
            a.conflicting,
        )


def test_alt_plan_does_not_share_the_applied_plans_ledger() -> None:
    req = cross_midnight("LINUCB")
    got = run(req)
    shared = single_pass(req)
    # Applied plan is unchanged by the second pass...
    assert [r.start_ms for r in got] == [r.start_ms for r in shared]
    s0, s1 = got[0], got[1]
    assert s0.linucb is not None and s0.start_ms == s0.linucb.start_ms
    assert local_date_str(s0.start_ms, "UTC") == "2026-09-21"
    assert s0.start_ms + 120 * MS_PER_MINUTE > NOW + 16 * HOUR  # past midnight
    # ...but s1's heuristic alternative is from the heuristic plan (its own s0
    # at 08:00), not squeezed around the applied LinUCB s0.
    assert s1.heuristic is not None and shared[1].heuristic is not None
    assert s1.heuristic.start_ms == NOW + 16 * HOUR  # 00:00 on day 2
    assert shared[1].heuristic.start_ms != s1.heuristic.start_ms


def _assert_plan_valid(plan: list[PlacedMember], req: PlaceRequest) -> None:
    dur = {m.id: m.duration_minutes * MS_PER_MINUTE for m in req.members}
    starts = [r.start_ms for r in plan]
    assert all(s is not None for s in starts)  # invariant 7 (PLACE)
    ivs = [(s, s + dur[r.id]) for s, r in zip(starts, plan, strict=True) if s]
    for i, (a0, a1) in enumerate(ivs):
        for b0, b1 in ivs[i + 1 :]:
            assert a1 <= b0 or b1 <= a0, "siblings overlap"
    days = [local_date_str(a0, "UTC") for a0, _ in ivs]
    for i, r in enumerate(plan):
        if r.outcome == "PLACED":
            assert days[:i].count(days[i]) < MAX_SERIES_PER_DAY


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_both_plans_respect_cap_and_sibling_non_overlap(scenario: Any) -> None:
    req = scenario("HEURISTIC")
    _assert_plan_valid(heuristic_only(req), req)
    _assert_plan_valid(linucb_only(req), req)


@pytest.mark.parametrize("policy", POLICIES)
def test_applied_plan_always_placed_and_last_resort_carries_no_pick(
    policy: str,
) -> None:
    req = cross_midnight(policy)
    got = run(req)
    _assert_plan_valid(got, req)
    assert [r.outcome for r in got[2:]] == ["ACCEPTED_LAST_RESORT"] * 2
    assert all(r.heuristic is None and r.linucb is None for r in got[2:])


def test_linucb_plan_member_falls_back_to_heuristic_when_linucb_finds_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = spread("LINUCB")
    real = _Placer.linucb

    def no_s1(self: _Placer, m: Any, *a: Any) -> Any:
        return None if m.id == "s1" else real(self, m, *a)

    monkeypatch.setattr(_Placer, "linucb", no_s1)
    got = run(req)
    assert got[1].outcome == "PLACED" and got[1].applied_policy == "HEURISTIC"
    assert got[1].linucb is None and got[1].start_ms is not None
    assert all(r.applied_policy == "LINUCB" for i, r in enumerate(got) if i != 1)


# ---- everything else is the single shared-ledger pass -----------------------


def _dump(rs: list[PlacedMember]) -> list[dict[str, Any]]:
    return [r.model_dump() for r in rs]


class _OkBatch:
    ok = True


def _gate(req: PlaceRequest) -> Any:
    return _Placer(req, _Timer())._dual_plan_policy(_OkBatch())  # type: ignore[arg-type]


@pytest.mark.parametrize("policy", POLICIES)
def test_non_sampled_series_is_single_pass(policy: str) -> None:
    req = spread(policy)
    req = with_members(
        req,
        [
            {**m.model_dump(by_alias=True, exclude_none=True), "computeBoth": False}
            for m in req.members
        ],
    )
    assert _gate(req) is None
    assert _dump(run(req)) == _dump(single_pass(req))


def test_partially_sampled_series_is_single_pass() -> None:
    req = spread("LINUCB")
    ms = [m.model_dump(by_alias=True, exclude_none=True) for m in req.members]
    ms[0]["computeBoth"] = False
    req = with_members(req, ms)
    assert _gate(req) is None
    assert _dump(run(req)) == _dump(single_pass(req))


def test_mixed_primary_policy_falls_back_to_the_per_member_single_pass() -> None:
    """Documented behaviour (not a 422): a series with a *mixed*
    ``primaryPolicy`` is the pre-#58 per-member roll, so it keeps the shared
    ledger and each member's own policy -- safe while Nest rolls over."""
    req = spread("LINUCB")
    ms = [m.model_dump(by_alias=True, exclude_none=True) for m in req.members]
    for i in (1, 3):
        ms[i]["primaryPolicy"] = "HEURISTIC"
    req = with_members(req, ms)
    assert _gate(req) is None
    got = run(req)
    assert _dump(got) == _dump(single_pass(req))
    assert [r.applied_policy for r in got] == [
        "LINUCB",
        "HEURISTIC",
        "LINUCB",
        "HEURISTIC",
        "LINUCB",
    ]


def test_preflight_sampled_series_is_single_pass() -> None:
    body = spread("LINUCB").model_dump(by_alias=True, exclude_none=True)
    body["mode"] = "PREFLIGHT"
    req = PlaceRequest.model_validate(body)
    assert _dump(run(req)) == _dump(single_pass(req))
    assert all(r.linucb is None for r in run(req))


def test_single_task_with_compute_both_is_unchanged() -> None:
    req = make_req(members=members("HEURISTIC", [60])[:1], bandit=bandit(warm_state(3)))
    assert _dump(run(req)) == _dump(single_pass(req))


def test_sampled_series_without_bandit_state_matches_single_pass() -> None:
    body = spread("LINUCB").model_dump(by_alias=True, exclude_none=True)
    body.pop("bandit")
    req = PlaceRequest.model_validate(body)
    got = run(req)
    assert _dump(got) == _dump(single_pass(req))
    assert all(r.applied_policy == "HEURISTIC" and r.linucb is None for r in got)


@pytest.mark.parametrize("scenario", SCENARIOS)
@pytest.mark.parametrize("policy", POLICIES)
def test_applied_placement_matches_the_single_pass(scenario: Any, policy: str) -> None:
    """Rollout safety: the primary plan *is* the old shared-ledger plan for a
    uniform-policy series -- only the alternative pick fields change."""
    req = scenario(policy)
    for r, s in zip(run(req), single_pass(req), strict=True):
        assert (r.start_ms, r.outcome, r.applied_policy) == (
            s.start_ms,
            s.outcome,
            s.applied_policy,
        )
