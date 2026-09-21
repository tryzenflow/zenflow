"""Authoritative placement for ``POST /v1/place`` (ADR-0003).

Pure orchestration over :mod:`src.core`: no I/O, no clock (``nowMs`` is a request
field), no randomness. Ports the TS heuristic / bandit / series placers and
displacement service (``5763a29``):

* one request = one placement event (a single task, or one materialized series);
* each member scans its own local-day window, skipping days already holding
  ``MAX_SERIES_PER_DAY`` siblings and never overlapping a sibling;
* HEURISTIC = best per-day preference slot; LINUCB = slot-first scan over all days;
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
from src.core.linucb_best_slot import LinucbCandidateDay, best_linucb_slot
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
from src.core.slot_score import best_free_slot, slot_preference_score, stability_score
from src.schemas import ARM_IDS, ArmId
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
    Weights,
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


class _Model:
    """In-process arm scoring from the supplied ``(A, b)`` (no /predict hop)."""

    def __init__(self, req: PlaceRequest) -> None:
        self.alpha = req.bandit.alpha if req.bandit else 0.0
        self._inv: dict[ArmId, tuple[NDArray[np.float64], NDArray[np.float64]] | None]
        self._inv = {}
        if req.bandit is None:
            return
        d, ridge = consts.FEATURE_DIM, req.bandit.ridge
        for arm in ARM_IDS:
            st = req.bandit.state.get(arm)
            if st is None or (not st.A and not st.b):
                self._inv[arm] = None  # cold arm -> fixed 0.0
                continue
            a = (
                np.asarray(st.A, dtype=np.float64).reshape(d, d)
                if st.A
                else ridge * np.identity(d)
            )
            b = np.asarray(st.b, dtype=np.float64) if st.b else np.zeros(d)
            a_inv = np.linalg.inv(a)
            self._inv[arm] = (a_inv, a_inv @ b)

    def scores(self, x: NDArray[np.float64]) -> dict[ArmId, NDArray[np.float64]]:
        """``theta.x + alpha*sqrt(x A^-1 x)`` per arm for every row of ``x``."""
        out: dict[ArmId, NDArray[np.float64]] = {}
        for arm in ARM_IDS:
            hit = self._inv.get(arm)
            if hit is None:
                out[arm] = np.zeros(x.shape[0])
                continue
            a_inv, theta = hit
            unc = np.sqrt(np.maximum(((x @ a_inv) * x).sum(axis=1), 0.0))
            out[arm] = x @ theta + self.alpha * unc
        return out


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
        self.model = _Model(req)
        self._vec_cache: dict[int, dict[str, NDArray[np.float64]]] = {}
        self._score_cache: dict[int, dict[str, dict[str, float]]] = {}

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

    def _arm_scores(self, duration: int) -> dict[str, dict[str, float]]:
        hit = self._score_cache.get(duration)
        if hit is not None:
            return hit
        vecs = self._vectors(duration)
        t0 = time.perf_counter()
        keys = list(vecs)
        x = (
            np.stack([vecs[k] for k in keys])
            if keys
            else np.empty((0, consts.FEATURE_DIM))
        )
        per_arm = self.model.scores(x)
        out: dict[str, dict[str, float]] = {
            k: {a: float(per_arm[a][i]) for a in ARM_IDS} for i, k in enumerate(keys)
        }
        self._score_cache[duration] = out
        self.t.predict += time.perf_counter() - t0
        return out

    # ---- policies --------------------------------------------------------
    def heuristic(
        self, m: PlacementMember, days: list[PlacementDay], extra: Intervals
    ) -> HeuristicPick | None:
        t0 = time.perf_counter()
        req = self.req
        dur_ms = m.duration_minutes * consts.MS_PER_MINUTE
        overhang = dur_ms - consts.SLOT_MS
        best: HeuristicPick | None = None
        for d in days:
            start_ceil = min(req.deadline_ms, d.day_end_ms)
            fit_ceil = min(req.deadline_ms, d.day_end_ms + overhang)
            window_start = max(req.now_ms, d.day_start_ms)
            slot = best_free_slot(
                m.duration_minutes,
                [*self.occ[d.day_str], *extra],
                window_start,
                start_ceil,
                self.matrix,
                self.tz,
                fit_ceil,
                m.prev_start_ms,
            )
            if slot is None:
                continue
            score = slot_preference_score(self.matrix, slot, slot + dur_ms, self.tz)
            if m.prev_start_ms is not None:
                score += stability_score(m.prev_start_ms, slot)
            if best is None or score > best.score:
                best = HeuristicPick(start_ms=slot, score=score)
        self.t.scan += time.perf_counter() - t0
        return best

    def linucb(
        self, m: PlacementMember, days: list[PlacementDay], extra: Intervals
    ) -> LinucbPick | None:
        if self.req.bandit is None or not days:
            return None
        try:
            scores = self._arm_scores(m.duration_minutes)
        except np.linalg.LinAlgError:
            return None
        vecs = self._vectors(m.duration_minutes)
        cand = [
            LinucbCandidateDay(
                day_str=d.day_str,
                day_start_ms=d.day_start_ms,
                day_end_ms=d.day_end_ms,
                occupied=self.occ[d.day_str],
                vector=vecs[d.day_str].tolist(),
                arm_scores=scores[d.day_str],
            )
            for d in days
        ]
        t0 = time.perf_counter()
        best = best_linucb_slot(
            cand,
            m.duration_minutes,
            self.tz,
            self.matrix,
            self.next15,
            self.req.deadline_ms,
            extra,
            m.prev_start_ms,
            self.req.user.observation_count,
        )
        self.t.scan += time.perf_counter() - t0
        if best is None or not math.isfinite(best.score):
            return None
        arm: ArmId = next(a for a in ARM_IDS if a == best.arm)
        return LinucbPick(
            start_ms=best.start_ms,
            score=best.score,
            selected_arm=arm,
            feature_vector=best.vector,
            weights=Weights(wL=best.weights.wL, wP=best.weights.wP),
        )

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
        preflight = req.mode == "PREFLIGHT"
        want_lin = not preflight and (m.primary_policy == "LINUCB" or m.compute_both)
        lin = self.linucb(m, days, extra) if want_lin else None
        need_heur = (
            preflight
            or m.primary_policy == "HEURISTIC"
            or m.compute_both
            or lin is None
        )
        heur = self.heuristic(m, days, extra) if need_heur else None

        if not preflight and m.primary_policy == "LINUCB" and lin is not None:
            return base.model_copy(
                update={
                    "outcome": "PLACED",
                    "applied_policy": "LINUCB",
                    "heuristic": heur,
                    "linucb": lin,
                    "start_ms": lin.start_ms,
                }
            )
        if heur is None:
            return self._no_slot(m, base)
        return base.model_copy(
            update={
                "outcome": "PLACED",
                "applied_policy": "HEURISTIC",
                "heuristic": heur,
                "linucb": lin,
                "start_ms": heur.start_ms,
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
