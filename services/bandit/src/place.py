"""Authoritative placement for ``POST /v1/place`` (ADR-0003).

Pure orchestration over :mod:`src.core` and :mod:`src.policies`: no I/O, no
clock (``nowMs`` is a request field), no randomness. Ports the TS heuristic /
bandit / series placers and displacement service (``5763a29``):

* one request = one placement event (a single task, or one materialized series);
* each member scans its own local-day window, skipping days already holding
  ``MAX_SERIES_PER_DAY`` siblings and never overlapping a sibling;
* :class:`~src.policies.heuristic.HeuristicPolicy` /
  :class:`~src.policies.linucb.LinucbPolicy` compute a pick each;
  :class:`~src.policies.selector.PolicySelector` is the A/B split deciding
  which one is applied (see ``place_member`` below);
* no free slot for a single member -> ``NEEDS_INFEASIBLE_CONTEXT``, then (with
  ``infeasible``) EDF displacement and the user's fallback.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.context_vector import build_context_vector
from src.core.displacement import (
    flexible_from_dicts,
    pick_late_slot,
    pick_min_conflict_slot,
    plan_displacement,
)
from src.core.series_spread import series_day_windows
from src.core.slot import (
    Intervals,
    add_days_str,
    ceil_to_slot,
    day_diff_str,
    deadline_day_str,
    iso_weekday,
    local_date_str,
    local_midnight_ms,
)
from src.policies.heuristic import HeuristicPolicy
from src.policies.linucb import LinucbPolicy
from src.policies.selector import PolicySelector
from src.schemas import ArmId
from src.schemas_place import (
    PLACEMENT_CONTRACT_VERSION,
    HeuristicPick,
    IntervalMs,
    LinucbPick,
    Move,
    Outcome,
    PlacedMember,
    PlacementDay,
    PlacementMember,
    PlaceRequest,
    PlaceResponse,
    Timings,
)


def _params_version() -> str:
    table: dict[str, object] = {
        k: getattr(consts, k)
        for k in sorted(dir(consts))
        if k.isupper() and not k.startswith("_")
    }
    table["PLACEMENT_CONTRACT_VERSION"] = PLACEMENT_CONTRACT_VERSION
    blob = json.dumps(table, sort_keys=True, default=list)
    return "py-" + hashlib.sha256(blob.encode()).hexdigest()[:12]


PARAMS_VERSION = _params_version()


def _ivals(items: list[IntervalMs]) -> Intervals:
    return [(i.start_ms, i.end_ms) for i in items]


@dataclass
class _Timer:
    decode: float = 0.0
    context: float = 0.0
    predict: float = 0.0
    scan: float = 0.0
    displace: float = 0.0


@dataclass
class _Ledger:
    siblings: Intervals
    count_by_day: dict[str, int] = field(default_factory=dict)


class _Placer:
    def __init__(self, req: PlaceRequest, timer: _Timer) -> None:
        self.req = req
        self.t = timer
        self.tz = req.timezone
        self.matrix = req.user.preference_matrix
        self.next15 = ceil_to_slot(req.now_ms)
        self.today = local_date_str(req.now_ms, req.timezone)
        self.day_by_str: dict[str, PlacementDay] = {d.day_str: d for d in req.days}
        self.occ: dict[str, Intervals] = {
            d.day_str: _ivals(d.occupied) for d in req.days
        }
        self.heuristic_policy = HeuristicPolicy(self.matrix, self.tz)
        self.linucb_policy = LinucbPolicy(req.bandit, self.matrix, self.tz)
        self._vec_cache: dict[int, dict[str, NDArray[np.float64]]] = {}
        self._score_cache: dict[int, dict[str, dict[ArmId, float]]] = {}

    # ---- helpers ---------------------------------------------------------
    def _select_days(
        self, first: str, last: str, ledger: _Ledger
    ) -> list[PlacementDay]:
        out: list[PlacementDay] = []
        day = first
        while day <= last and len(out) < self.req.max_scan_days:
            d = self.day_by_str.get(day)
            capped = ledger.count_by_day.get(day, 0) >= consts.MAX_SERIES_PER_DAY
            if d is not None and not capped:
                out.append(d)
            day = add_days_str(day, 1)
        return out

    def _vectors(self, duration: int) -> dict[str, NDArray[np.float64]]:
        hit = self._vec_cache.get(duration)
        if hit is not None:
            return hit
        t0 = time.perf_counter()
        req = self.req
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
                candidate_days_from_now=max(0, day_diff_str(self.today, d.day_str)),
                workload_by_type=wl,
                semester_phase=None,
            )
        self._vec_cache[duration] = vecs
        self.t.context += time.perf_counter() - t0
        return vecs

    def _arm_scores(self, duration: int) -> dict[str, dict[ArmId, float]]:
        hit = self._score_cache.get(duration)
        if hit is not None:
            return hit
        vecs = self._vectors(duration)
        t0 = time.perf_counter()
        out = self.linucb_policy.arm_scores(vecs)
        self._score_cache[duration] = out
        self.t.predict += time.perf_counter() - t0
        return out

    # ---- policies --------------------------------------------------------
    def heuristic(
        self, m: PlacementMember, days: list[PlacementDay], extra: Intervals
    ) -> HeuristicPick | None:
        t0 = time.perf_counter()
        pick = self.heuristic_policy.best_slot(
            m, days, self.occ, extra, self.req.now_ms, self.req.deadline_ms
        )
        self.t.scan += time.perf_counter() - t0
        return pick

    def linucb(
        self, m: PlacementMember, days: list[PlacementDay], extra: Intervals
    ) -> LinucbPick | None:
        if not self.linucb_policy.enabled or not days:
            return None
        try:
            scores = self._arm_scores(m.duration_minutes)
        except np.linalg.LinAlgError:
            return None
        vecs = self._vectors(m.duration_minutes)
        t0 = time.perf_counter()
        pick = self.linucb_policy.best_slot(
            m,
            days,
            self.occ,
            vecs,
            scores,
            extra,
            self.next15,
            self.req.deadline_ms,
            self.req.user.observation_count,
        )
        self.t.scan += time.perf_counter() - t0
        return pick

    # ---- one member ------------------------------------------------------
    def place_member(
        self, m: PlacementMember, first: str, last: str, ledger: _Ledger
    ) -> PlacedMember:
        req = self.req
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
        if self.next15 + dur_ms > req.deadline_ms:
            return self._no_slot(m, base)

        days = self._select_days(first, last, ledger)
        extra = list(ledger.siblings)
        lin = (
            self.linucb(m, days, extra)
            if PolicySelector.should_try_linucb(req.mode, m)
            else None
        )
        heur = (
            self.heuristic(m, days, extra)
            if PolicySelector.should_try_heuristic(req.mode, m, lin)
            else None
        )

        decision = PolicySelector.resolve(req.mode, m, heur, lin)
        if decision is None:
            return self._no_slot(m, base)
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

    def _no_slot(self, m: PlacementMember, base: PlacedMember) -> PlacedMember:
        req = self.req
        if len(req.members) > 1:  # series members are never displaced (TS parity)
            return base
        if req.infeasible is None:
            return base.model_copy(update={"outcome": "NEEDS_INFEASIBLE_CONTEXT"})
        t0 = time.perf_counter()
        try:
            return self._resolve_infeasible(m, base)
        finally:
            self.t.displace += time.perf_counter() - t0

    def _resolve_infeasible(
        self, m: PlacementMember, base: PlacedMember
    ) -> PlacedMember:
        req = self.req
        ctx = req.infeasible
        assert ctx is not None
        dd = deadline_day_str(req.deadline_ms, self.tz)
        ds = local_midnight_ms(dd, self.tz)
        de = local_midnight_ms(add_days_str(dd, 1), self.tz)
        plan = plan_displacement(
            m.duration_minutes,
            req.deadline_ms,
            flexible_from_dicts(
                [
                    {
                        "id": f.id,
                        "durationMinutes": f.duration_minutes,
                        "deadlineMs": f.deadline_ms,
                        "startMs": f.start_ms,
                    }
                    for f in ctx.flexible
                ]
            ),
            _ivals(ctx.fixed),
            req.now_ms,
            [(ds, de), (ds - consts.DAY_MS, de + consts.DAY_MS)],
            self.matrix,
            self.tz,
        )
        if plan.kind == "placed" and plan.start_ms is not None:
            return base.model_copy(
                update={
                    "outcome": "DISPLACED",
                    "applied_policy": "HEURISTIC",
                    "start_ms": plan.start_ms,
                    "moves": [
                        Move(id=v.id, from_ms=v.from_ms, to_ms=v.to_ms)
                        for v in plan.moves
                    ],
                }
            )
        horizon = _ivals(ctx.horizon_occupied)
        if ctx.policy == "ACCEPT_CONFLICTS":
            s = pick_min_conflict_slot(
                m.duration_minutes,
                req.now_ms,
                req.deadline_ms,
                horizon,
                self.matrix,
                self.tz,
            )
            if s is not None:
                end = s + m.duration_minutes * consts.MS_PER_MINUTE
                clash = any(s < e and end > b for b, e in horizon)
                return self._accepted(base, "ACCEPTED_CONFLICTS", s, conflicting=clash)
        elif ctx.policy == "ACCEPT_LATE_DEADLINE":
            s = pick_late_slot(
                m.duration_minutes,
                req.now_ms,
                req.deadline_ms,
                horizon,
                req.deadline_ms + consts.INFEASIBLE_HORIZON_DAYS * consts.DAY_MS,
            )
            if s is not None:
                return self._accepted(base, "ACCEPTED_LATE", s, late=True)
        return base

    @staticmethod
    def _accepted(
        base: PlacedMember,
        outcome: Outcome,
        start: int,
        late: bool = False,
        conflicting: bool = False,
    ) -> PlacedMember:
        return base.model_copy(
            update={
                "outcome": outcome,
                "applied_policy": "HEURISTIC",
                "start_ms": start,
                "late": late,
                "conflicting": conflicting,
            }
        )

    # ---- whole request ---------------------------------------------------
    def run(self) -> list[PlacedMember]:
        req = self.req
        ledger = _Ledger(siblings=_ivals(req.fixed_occupied))
        members = req.members

        if len(members) == 1:
            first = local_date_str(self.next15, self.tz)
            last = local_date_str(req.deadline_ms - 1, self.tz)
            return [self.place_member(members[0], first, last, ledger)]

        if self.next15 >= req.deadline_ms:
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
            math.floor((req.deadline_ms - self.next15) / consts.DAY_MS),
            consts.MAX_SCAN_DAYS - 1,
        )
        windows = series_day_windows(span, len(members))
        start_day = local_date_str(self.next15, self.tz)
        results: list[PlacedMember] = []
        for m, (lo, hi) in zip(members, windows, strict=True):
            r = self.place_member(
                m, add_days_str(start_day, lo), add_days_str(start_day, hi), ledger
            )
            results.append(r)
            if r.start_ms is not None:
                ledger.siblings.append(
                    (r.start_ms, r.start_ms + m.duration_minutes * consts.MS_PER_MINUTE)
                )
                day = local_date_str(r.start_ms, self.tz)
                ledger.count_by_day[day] = ledger.count_by_day.get(day, 0) + 1
        return results


def place(req: PlaceRequest, decode_s: float = 0.0) -> PlaceResponse:
    """Run one placement. ``decode_s`` is the HTTP layer's body-parse time."""
    t_start = time.perf_counter()
    timer = _Timer(decode=decode_s)
    results = _Placer(req, timer).run()
    total = decode_s + (time.perf_counter() - t_start)

    def ms(v: float) -> float:
        return round(v * 1000.0, 3)

    return PlaceResponse(
        contract_version=PLACEMENT_CONTRACT_VERSION,
        request_id=req.request_id,
        params_version=PARAMS_VERSION,
        results=results,
        timings_ms=Timings(
            decode=ms(timer.decode),
            context=ms(timer.context),
            predict=ms(timer.predict),
            scan=ms(timer.scan),
            displace=ms(timer.displace),
            total=ms(total),
        ),
    )
