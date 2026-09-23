"""Output-equivalence tests for `_Placer._build_batch`'s (M, N, D) tensor path.

`_Placer` used to rebuild each member's LinUCB context vectors / arm scores
from scratch per distinct `duration_minutes` (`_vectors`/`_arm_scores`, keyed
by duration only, cached across the request). It now builds one batched
`(M, N, D)` tensor up front (`_build_batch`, `M` = member count including
`M=1` for a lone task, `N` = max candidate-day count across members, padded
with a validity mask) and scores all 5 arms against it in one broadcast call
per arm.

`_old_run` below is a reconstruction of the pre-batch sequential algorithm
(the deleted `_vectors`/`_arm_scores` + per-member `linucb()`/`place_member()`
loop), built only out of pieces of `_Placer` that this change left untouched
(`_select_days`, `heuristic()`, `_no_slot`, `linucb_policy.best_slot`). Every
test below asserts the new batched `_Placer.run()` reproduces it exactly,
field for field, across the scenarios called out in the design doc: a single
task (`M=1`), a disjoint-window series, a dense/overlapping-window series, an
all-cold-arm request, and a DST-boundary candidate day.
"""

from __future__ import annotations

import copy
import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.constants import DAY_MS, FEATURE_DIM, MS_PER_MINUTE
from src.core.context_vector import build_context_vector
from src.core.preference import default_preference_matrix
from src.core.series_spread import series_day_windows
from src.core.slot import (
    add_days_str,
    day_diff_str,
    iso_weekday,
    local_date_str,
    local_midnight_ms,
)
from src.models.linucb import score as linucb_score
from src.place import _ivals, _Ledger, _Placer, _Timer
from src.policies.selector import PolicySelector
from src.schemas import ARM_IDS, ArmId
from src.schemas_place import PlacedMember, PlaceRequest

HOUR = 60 * MS_PER_MINUTE
NOW = 1_789_977_600_000  # Mon 2026-09-21 08:00 UTC
ZERO_WL = {
    t: {"hours": 0, "count": 0}
    for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
}


def make_days(
    n: int,
    tz: str = "UTC",
    occupied: dict[int, list[tuple[int, int]]] | None = None,
    start_day: str = "2026-09-21",
) -> list[dict[str, Any]]:
    occupied = occupied or {}
    out = []
    for i in range(n):
        ds = add_days_str(start_day, i)
        out.append(
            {
                "dayStr": ds,
                "dayStartMs": local_midnight_ms(ds, tz),
                "dayEndMs": local_midnight_ms(add_days_str(ds, 1), tz),
                "occupied": [
                    {"startMs": a, "endMs": b} for a, b in occupied.get(i, [])
                ],
                "workloadByType": copy.deepcopy(ZERO_WL),
            }
        )
    return out


def member(
    mid: str = "t1", dur: int = 60, policy: str = "LINUCB", both: bool = False
) -> dict[str, Any]:
    return {
        "id": mid,
        "durationMinutes": dur,
        "primaryPolicy": policy,
        "computeBoth": both,
    }


def make_req(**kw: Any) -> PlaceRequest:
    req: dict[str, Any] = {
        "contractVersion": 1,
        "requestId": "test-batch",
        "mode": "PLACE",
        "nowMs": NOW,
        "timezone": "UTC",
        "deadlineMs": NOW + 5 * DAY_MS,
        "maxScanDays": 30,
        "members": [member()],
        "fixedOccupied": [],
        "days": make_days(6),
        "user": {
            "preferenceMatrix": default_preference_matrix().tolist(),
            "observationCount": 0,
        },
    }
    req.update(kw)
    return PlaceRequest.model_validate(req)


def warm_state(seed: int = 3) -> dict[str, dict[str, list[float]]]:
    rng = np.random.default_rng(seed)
    state: dict[str, dict[str, list[float]]] = {}
    for arm in ARM_IDS:
        x = rng.normal(size=(40, FEATURE_DIM))
        a = np.eye(FEATURE_DIM) + x.T @ x / 10
        b = rng.normal(size=FEATURE_DIM) * 0.5
        state[arm] = {"A": a.reshape(-1).tolist(), "b": b.tolist()}
    return state


def cold_state() -> dict[str, dict[str, list[float]]]:
    return {a: {"A": [], "b": []} for a in ARM_IDS}


def bandit(
    state: dict[str, Any], alpha: float = 0.15, ridge: float = 1.0
) -> dict[str, Any]:
    return {"alpha": alpha, "ridge": ridge, "state": state}


# ---- oracle: the pre-batch sequential algorithm, reconstructed -----------


def _old_run(req: PlaceRequest) -> list[PlacedMember]:
    """Reference reimplementation of `_Placer.run()` *before* B.2/B.3's
    batching: `_vectors`/`_arm_scores` cached by `duration_minutes` only,
    rebuilt from scratch per distinct duration, called from inside a
    per-member `linucb()`. Built only from pieces of `_Placer` this change
    left untouched, so any divergence from the new batched `run()` is a real
    behavioural regression, not oracle drift.
    """
    placer = _Placer(req, _Timer())
    vec_cache: dict[int, dict[str, NDArray[np.float64]]] = {}
    score_cache: dict[int, dict[str, dict[ArmId, float]]] = {}

    def vectors(duration: int) -> dict[str, NDArray[np.float64]]:
        hit = vec_cache.get(duration)
        if hit is not None:
            return hit
        remaining = max(0, math.floor((req.deadline_ms - req.now_ms) / consts.DAY_MS))
        vecs: dict[str, NDArray[np.float64]] = {}
        for d in req.days:
            wl: dict[str, dict[str, float]] = {
                k: {"hours": v.hours, "count": v.count}
                for k, v in d.workload_by_type.items()
            }
            vecs[d.day_str] = build_context_vector(
                remaining_days_until_deadline=remaining,
                duration_minutes=duration,
                candidate_iso_weekday=iso_weekday(d.day_str),
                candidate_days_from_now=max(0, day_diff_str(placer.today, d.day_str)),
                workload_by_type=wl,
                semester_phase=None,
            )
        vec_cache[duration] = vecs
        return vecs

    def arm_scores(duration: int) -> dict[str, dict[ArmId, float]]:
        hit = score_cache.get(duration)
        if hit is not None:
            return hit
        vecs = vectors(duration)
        keys = list(vecs)
        x = (
            np.stack([vecs[k] for k in keys])
            if keys
            else np.empty((0, FEATURE_DIM))
        )
        per_arm: dict[ArmId, NDArray[np.float64]] = {}
        for arm in ARM_IDS:
            params = placer.linucb_policy._arms.get(arm)
            if params is None:
                per_arm[arm] = np.zeros(x.shape[0])
                continue
            per_arm[arm] = np.asarray(
                linucb_score(params.A, params.b, x, placer.linucb_policy.alpha),
                dtype=np.float64,
            )
        out: dict[str, dict[ArmId, float]] = {
            k: {a: float(per_arm[a][i]) for a in ARM_IDS} for i, k in enumerate(keys)
        }
        score_cache[duration] = out
        return out

    def old_linucb(m: Any, days: Any, extra: Any) -> Any:
        if not placer.linucb_policy.enabled or not days:
            return None
        try:
            scores = arm_scores(m.duration_minutes)
        except np.linalg.LinAlgError:
            return None
        vecs = vectors(m.duration_minutes)
        return placer.linucb_policy.best_slot(
            m,
            days,
            placer.occ,
            vecs,
            scores,
            extra,
            placer.next15,
            req.deadline_ms,
            req.user.observation_count,
        )

    def old_place_member(
        m: Any, first: str, last: str, ledger: _Ledger
    ) -> PlacedMember:
        base = PlacedMember(
            id=m.id,
            outcome="INFEASIBLE",
            applied_policy="NONE",
            heuristic=None,
            linucb=None,
            start_ms=None,
            moves=[],
            late=False,
            conflicting=False,
        )
        dur_ms = m.duration_minutes * consts.MS_PER_MINUTE
        if placer.next15 + dur_ms > req.deadline_ms:
            return placer._no_slot(m, base)
        days = placer._select_days(first, last, ledger)
        extra = list(ledger.siblings)
        lin = (
            old_linucb(m, days, extra)
            if PolicySelector.should_try_linucb(req.mode, m)
            else None
        )
        heur = (
            placer.heuristic(m, days, extra)
            if PolicySelector.should_try_heuristic(req.mode, m, lin)
            else None
        )
        decision = PolicySelector.resolve(req.mode, m, heur, lin)
        if decision is None:
            return placer._no_slot(m, base)
        policy, start_ms = decision
        return base.model_copy(
            update={
                "outcome": "PLACED",
                "applied_policy": policy,
                "heuristic": heur,
                "linucb": lin,
                "start_ms": start_ms,
            }
        )

    ledger = _Ledger(siblings=_ivals(req.fixed_occupied))
    members = req.members
    if len(members) == 1:
        first = local_date_str(placer.next15, placer.tz)
        last = local_date_str(req.deadline_ms - 1, placer.tz)
        return [old_place_member(members[0], first, last, ledger)]

    if placer.next15 >= req.deadline_ms:
        return [
            PlacedMember(
                id=m.id,
                outcome="INFEASIBLE",
                applied_policy="NONE",
                heuristic=None,
                linucb=None,
                start_ms=None,
                moves=[],
                late=False,
                conflicting=False,
            )
            for m in members
        ]
    span = min(
        math.floor((req.deadline_ms - placer.next15) / consts.DAY_MS),
        consts.MAX_SCAN_DAYS - 1,
    )
    windows = series_day_windows(span, len(members))
    start_day = local_date_str(placer.next15, placer.tz)
    results: list[PlacedMember] = []
    for m, (lo, hi) in zip(members, windows, strict=True):
        r = old_place_member(
            m, add_days_str(start_day, lo), add_days_str(start_day, hi), ledger
        )
        results.append(r)
        if r.start_ms is not None:
            ledger.siblings.append(
                (r.start_ms, r.start_ms + m.duration_minutes * consts.MS_PER_MINUTE)
            )
            day = local_date_str(r.start_ms, placer.tz)
            ledger.count_by_day[day] = ledger.count_by_day.get(day, 0) + 1
    return results


def _assert_equivalent(req: PlaceRequest) -> list[PlacedMember]:
    new_results = _Placer(req, _Timer()).run()
    old_results = _old_run(req)
    assert len(new_results) == len(old_results)
    for new, old in zip(new_results, old_results, strict=True):
        assert new.model_dump() == old.model_dump(), (new.id, new, old)
    return new_results


# ---- scenarios -------------------------------------------------------------


def test_single_task_m1_matches_oracle() -> None:
    """M = 1: the lone-task path goes through the same batched `_build_batch`
    with no special-casing, not a hand-rolled fast path."""
    req = make_req(members=[member(dur=90)], bandit=bandit(warm_state()))
    results = _assert_equivalent(req)
    assert results[0].outcome == "PLACED"
    assert results[0].linucb is not None


def test_disjoint_window_series_matches_oracle() -> None:
    """Members' windows don't overlap -> each gets its own distinct N (no
    day ever gets capped by a sibling), exercising the (M, N) padding mask
    when per-member day-list lengths differ."""
    members = [member(f"s{i}", dur=120) for i in range(4)]
    req = make_req(
        members=members,
        deadlineMs=NOW + 8 * DAY_MS,
        days=make_days(9),
        maxScanDays=60,
        bandit=bandit(warm_state()),
    )
    results = _assert_equivalent(req)
    assert all(r.outcome == "PLACED" for r in results)
    days = [local_date_str(r.start_ms, "UTC") for r in results]  # type: ignore[arg-type]
    assert len(set(days)) == 4  # MAX_SERIES_PER_DAY = 1, spread across days


def test_dense_overlapping_series_threads_siblings_correctly() -> None:
    """A short deadline forces every member's window onto the same handful
    of days -- the MAX_SERIES_PER_DAY cap kicks in as members are placed,
    shrinking later members' live-selected day count below what the batch's
    upfront (uncapped) day list predicted. This is exactly the case the
    `place_member` subset assert (B.4) guards, and the case where each
    member's row in the (M, N) tensor legitimately differs in valid-day
    count."""
    members = [member(f"d{i}", dur=60) for i in range(3)]
    req = make_req(
        members=members,
        deadlineMs=NOW + 2 * DAY_MS,
        days=make_days(3),
        maxScanDays=60,
        bandit=bandit(warm_state()),
    )
    results = _assert_equivalent(req)
    placed_days = [
        local_date_str(r.start_ms, "UTC") for r in results if r.start_ms is not None
    ]
    assert len(set(placed_days)) == len(placed_days)  # never double-booked a day


def test_all_cold_arms_matches_oracle() -> None:
    """Every arm cold (no A/b) -> arm scores are 0.0 everywhere by contract
    (the batch tensor's arm-score slices, not just the final pick)."""
    req = make_req(
        members=[member(dur=60), member("t2", dur=60)],
        deadlineMs=NOW + 3 * DAY_MS,
        days=make_days(4),
        maxScanDays=60,
        bandit=bandit(cold_state()),
    )
    results = _assert_equivalent(req)
    assert any(r.linucb is not None for r in results)

    placer = _Placer(req, _Timer())
    ledger = _Ledger(siblings=[])
    first = local_date_str(placer.next15, placer.tz)
    last = local_date_str(req.deadline_ms - 1, placer.tz)
    windows_days = [(first, last), (first, last)]
    batch = placer._build_batch(req.members, windows_days, ledger)
    for arr in batch.arm_scores.values():
        assert (arr[batch.valid] == 0.0).all()


def test_dst_boundary_day_matches_oracle() -> None:
    """One candidate day is a 23-hour DST-start day (`best_linucb_slot`'s
    scalar, non-1440-minute branch) -- the batched tensor's per-day arm-score
    slice must still line up with the right day after the scalar branch
    picks a slot on it."""
    tz = "America/New_York"
    start_day = "2026-03-07"  # 03-08 (index 1) is DST start (23h day)
    days = make_days(4, tz=tz, start_day=start_day)
    assert days[1]["dayEndMs"] - days[1]["dayStartMs"] == 23 * HOUR
    now = days[0]["dayStartMs"]
    req = make_req(
        nowMs=now,
        timezone=tz,
        members=[member(dur=90), member("t2", dur=45)],
        deadlineMs=now + 4 * DAY_MS,
        days=days,
        maxScanDays=60,
        bandit=bandit(warm_state()),
    )
    _assert_equivalent(req)


def test_build_batch_pads_and_masks_shorter_members() -> None:
    """Direct check on `_build_batch`'s tensor shape/masking contract: `N`
    is the max day-count across members, shorter members are padded with an
    invalid (masked) tail, and arm scores are exactly 0 on padding."""
    from src.core.slot import local_date_str as _lds

    req = make_req(
        members=[member("long", dur=60), member("short", dur=60)],
        deadlineMs=NOW + 6 * DAY_MS,
        days=make_days(7),
        maxScanDays=60,
        bandit=bandit(warm_state()),
    )
    placer = _Placer(req, _Timer())
    first_long = _lds(placer.next15, placer.tz)
    last_long = _lds(req.deadline_ms - 1, placer.tz)
    # Give "short" a narrower window than "long" so N is set by "long" and
    # "short"'s row is padded.
    windows_days = [(first_long, last_long), (first_long, add_days_str(first_long, 1))]
    ledger = _Ledger(siblings=[])
    batch = placer._build_batch(req.members, windows_days, ledger)

    m, n, d = batch.vectors.shape
    assert m == 2
    assert d == FEATURE_DIM
    n_short = len(batch.per_member_days[1])
    n_long = len(batch.per_member_days[0])
    assert n == max(n_long, n_short) and n_short < n_long
    assert batch.valid[1, :n_short].all()
    assert not batch.valid[1, n_short:].any()
    for arr in batch.arm_scores.values():
        assert (arr[~batch.valid] == 0.0).all()
