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
* a pairwise-sampled series (all members ``computeBoth`` with one shared
  ``primaryPolicy``, #58) is placed twice -- an all-heuristic and an all-LinUCB
  plan, each with its own sibling ledger (see ``_dual_plan_policy``);
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
from src.core.arms import seeded_tie_break_order
from src.core.context_vector import build_context_vector
from src.core.displacement import (
    flexible_from_dicts,
    last_resort_pin,
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
    PlacementPolicy,
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


@dataclass
class _ScoreBatch:
    """One request's worth of precomputed LinUCB context/arm-score tensors.

    Built once per request (:meth:`_Placer._build_batch`), covering every
    member (``M``, always -- ``M=1`` for a lone task) and the union of
    candidate days any member could ever select (``N``, padded to the max
    across members). Replaces the old per-``duration_minutes`` dict caches
    (``_vec_cache``/``_score_cache``), which recomputed vectors/arm-scores
    from scratch on every distinct duration seen across the request.
    """

    per_member_days: list[list[PlacementDay]]
    day_index: list[dict[str, int]]  # per member: dayStr -> column j
    valid: NDArray[np.bool_]  # (M, N) -- False on padding
    vectors: NDArray[np.float64]  # (M, N, D)
    arm_scores: dict[ArmId, NDArray[np.float64]]  # each (M, N)
    ok: bool = True  # False if LinUCB's A matrices were singular for this request


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
        self.linucb_policy = LinucbPolicy(req.bandit, self.tz)

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

    def _build_batch(
        self,
        members: list[PlacementMember],
        windows_days: list[tuple[str, str]],
        ledger: _Ledger,
    ) -> _ScoreBatch:
        """Batch every member's candidate-day context vectors + arm scores.

        Builds one ``(M, N, D)`` tensor across all of ``members`` (``M=1``
        for a lone task, no special-casing) and scores all 6 arms against it
        in one broadcast pass -- replacing the old ``_vectors``/
        ``_arm_scores`` dict caches keyed by ``duration_minutes``, which
        rebuilt vectors from scratch per distinct duration and looped over
        arms per member.

        Per-member day lists come from ``self._select_days(first, last,
        ledger)`` called independently for each member, against ``ledger``
        *as it stands right now* -- i.e. before :meth:`run` has placed
        anyone in this request. ``_select_days``'s only ledger-dependent
        input is ``count_by_day``, which starts empty and only grows as
        members get placed later in :meth:`run`'s loop -- so this is always
        a superset of whatever a live (in-loop, post-placement) call to
        ``_select_days`` for the same window will select. ``place_member``
        asserts that invariant against the real, live call.
        """
        req = self.req
        m_count = len(members)
        d_dim = consts.FEATURE_DIM
        remaining = max(0, math.floor((req.deadline_ms - req.now_ms) / consts.DAY_MS))

        per_member_days: list[list[PlacementDay]] = [
            self._select_days(first, last, ledger) for first, last in windows_days
        ]
        n_cols = max((len(days) for days in per_member_days), default=0)

        valid = np.zeros((m_count, n_cols), dtype=bool)
        day_index: list[dict[str, int]] = [{} for _ in range(m_count)]
        for i, days in enumerate(per_member_days):
            for j, d in enumerate(days):
                valid[i, j] = True
                day_index[i][d.day_str] = j

        x = np.zeros((m_count, n_cols, d_dim), dtype=np.float64)
        if self.linucb_policy.enabled and n_cols:
            t0 = time.perf_counter()
            for i, (m, days) in enumerate(zip(members, per_member_days, strict=True)):
                for j, d in enumerate(days):
                    wl: dict[str, dict[str, float]] = {
                        k: {"hours": v.hours, "count": v.count}
                        for k, v in d.workload_by_type.items()
                    }
                    x[i, j] = build_context_vector(
                        remaining_days_until_deadline=remaining,
                        duration_minutes=m.duration_minutes,
                        candidate_iso_weekday=iso_weekday(d.day_str),
                        candidate_days_from_now=max(
                            0, day_diff_str(self.today, d.day_str)
                        ),
                        workload_by_type=wl,
                    )
            self.t.context += time.perf_counter() - t0

            t1 = time.perf_counter()
            ok = True
            try:
                arm_scores = self.linucb_policy.arm_scores_batch(x)
            except np.linalg.LinAlgError:
                ok = False
                arm_scores = {arm: np.zeros((m_count, n_cols)) for arm in ARM_IDS}
            else:
                for arr in arm_scores.values():
                    arr[~valid] = 0.0
            self.t.predict += time.perf_counter() - t1
        else:
            ok = True
            arm_scores = {arm: np.zeros((m_count, n_cols)) for arm in ARM_IDS}

        return _ScoreBatch(
            per_member_days=per_member_days,
            day_index=day_index,
            valid=valid,
            vectors=x,
            arm_scores=arm_scores,
            ok=ok,
        )

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
        self,
        m: PlacementMember,
        days: list[PlacementDay],
        extra: Intervals,
        batch: _ScoreBatch,
        i: int,
    ) -> LinucbPick | None:
        if not self.linucb_policy.enabled or not days or not batch.ok:
            return None
        idx = batch.day_index[i]
        vecs = {d.day_str: batch.vectors[i, idx[d.day_str]] for d in days}
        scores = {
            d.day_str: {
                arm: float(batch.arm_scores[arm][i, idx[d.day_str]]) for arm in ARM_IDS
            }
            for d in days
        }
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
            seeded_tie_break_order(f"{self.req.request_id}|{m.id}"),
        )
        self.t.scan += time.perf_counter() - t0
        return pick

    # ---- one member ------------------------------------------------------
    def place_member(
        self,
        m: PlacementMember,
        first: str,
        last: str,
        ledger: _Ledger,
        batch: _ScoreBatch,
        i: int,
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
            return self._no_slot(m, base, ledger)

        days = self._select_days(first, last, ledger)
        # B.4 correctness invariant: every day this *live* (post-placement)
        # call selects must already be a column in the batch built upfront
        # for this member -- see `_build_batch`'s docstring for why that's
        # guaranteed (count_by_day only grows after batch-build time).
        assert all(d.day_str in batch.day_index[i] for d in days), (
            f"member {m.id!r}: live _select_days picked a day outside the "
            "batch's upfront candidate set"
        )
        extra = list(ledger.siblings)
        lin = (
            self.linucb(m, days, extra, batch, i)
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
            return self._no_slot(m, base, ledger)
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

    def _no_slot(
        self, m: PlacementMember, base: PlacedMember, ledger: _Ledger
    ) -> PlacedMember:
        req = self.req
        if len(req.members) > 1:  # series members are never displaced (TS parity)
            known = [iv for day in self.occ.values() for iv in day]
            return self._last_resort(
                m, base, [*known, *ledger.siblings], ledger.siblings, late=False
            )
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
            _ivals(ctx.horizon_occupied),
            req.deadline_ms + consts.INFEASIBLE_HORIZON_DAYS * consts.DAY_MS,
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
        return self._last_resort(m, base, horizon, [], late=True)

    def _last_resort(
        self,
        m: PlacementMember,
        base: PlacedMember,
        occupied: Intervals,
        avoid: Intervals,
        late: bool,
    ) -> PlacedMember:
        """PLACE only: a TASK row already exists, so it must get *some* start.
        Least-conflict slot before the deadline, else (``late``) the first free
        slot within the +30-day horizon, else the pinned latest start. PREFLIGHT
        keeps answering INFEASIBLE so Nest can still 409 / 400 first."""
        req = self.req
        if req.mode != "PLACE":
            return base
        s = pick_min_conflict_slot(
            m.duration_minutes,
            req.now_ms,
            req.deadline_ms,
            occupied,
            self.matrix,
            self.tz,
        )
        if s is None and late:
            s = pick_late_slot(
                m.duration_minutes,
                req.now_ms,
                req.deadline_ms,
                occupied,
                req.deadline_ms + consts.INFEASIBLE_HORIZON_DAYS * consts.DAY_MS,
            )
        if s is None:
            s = last_resort_pin(m.duration_minutes, req.now_ms, req.deadline_ms, avoid)
        end = s + m.duration_minutes * consts.MS_PER_MINUTE
        return self._accepted(
            base,
            "ACCEPTED_LAST_RESORT",
            s,
            late=end > req.deadline_ms,
            conflicting=any(s < e and end > b for b, e in occupied),
        )

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
    def _past_deadline_series(self, ledger: _Ledger) -> list[PlacedMember]:
        """Series whose deadline has passed: nothing is scanned. PLACE pins the
        sittings back-to-back from the next slot (never unplaced); PREFLIGHT
        answers INFEASIBLE."""
        out: list[PlacedMember] = []
        for m in self.req.members:
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
            r = self._last_resort(m, base, [], ledger.siblings, late=False)
            if r.start_ms is not None:
                ledger.siblings.append(
                    (r.start_ms, r.start_ms + m.duration_minutes * consts.MS_PER_MINUTE)
                )
            out.append(r)
        return out

    def _dual_plan_policy(self, batch: _ScoreBatch) -> PlacementPolicy | None:
        """The series' primary policy if this request asks for two full plans.

        A materialized series (``len(members) > 1``) whose members *all* set
        ``computeBoth`` and share one ``primaryPolicy`` is a pairwise-sampled
        series (issue #58: Nest rolls the policy once per series and the
        pairwise sample once per series). Then :meth:`run` computes a complete
        heuristic-only plan and a complete LinUCB plan, each against its own
        :class:`_Ledger`. Everything else -- a lone task, ``PREFLIGHT``, a
        series where only some members set ``computeBoth``, or a series with a
        *mixed* ``primaryPolicy`` (the pre-#58 per-member roll) -- keeps the
        single shared-ledger pass, byte-identical to before. With LinUCB
        unavailable (no bandit state / singular ``A``) the LinUCB plan would
        just be the heuristic plan again, so the single pass is used too (its
        output is identical in that case).
        """
        req = self.req
        members = req.members
        if req.mode != "PLACE" or len(members) < 2:
            return None
        if not all(m.compute_both for m in members):
            return None
        policies = {m.primary_policy for m in members}
        if len(policies) != 1:
            return None
        if not self.linucb_policy.enabled or not batch.ok:
            return None
        return policies.pop()

    def _run_plan(
        self,
        windows_days: list[tuple[str, str]],
        batch: _ScoreBatch,
        policy: PlacementPolicy | None,
    ) -> list[PlacedMember]:
        """Place every member in order against one fresh :class:`_Ledger`.

        ``policy=None`` honours each member's own ``primaryPolicy`` /
        ``computeBoth`` (the single-pass behaviour). ``"HEURISTIC"`` /
        ``"LINUCB"`` force that policy for every member with ``computeBoth``
        off -- a LinUCB member still falls back to the heuristic when LinUCB
        finds no slot (:meth:`PolicySelector.resolve`), and a member neither
        policy can seat gets this plan's own last resort (invariant 7).
        """
        ledger = _Ledger(siblings=_ivals(self.req.fixed_occupied))
        results: list[PlacedMember] = []
        for i, (m, (first, last)) in enumerate(
            zip(self.req.members, windows_days, strict=True)
        ):
            pm = (
                m
                if policy is None
                else m.model_copy(
                    update={"primary_policy": policy, "compute_both": False}
                )
            )
            r = self.place_member(pm, first, last, ledger, batch, i)
            results.append(r)
            if r.start_ms is not None:
                ledger.siblings.append(
                    (r.start_ms, r.start_ms + m.duration_minutes * consts.MS_PER_MINUTE)
                )
                day = local_date_str(r.start_ms, self.tz)
                ledger.count_by_day[day] = ledger.count_by_day.get(day, 0) + 1
        return results

    def run(self) -> list[PlacedMember]:
        req = self.req
        members = req.members

        if len(members) == 1:
            first = local_date_str(self.next15, self.tz)
            last = local_date_str(req.deadline_ms - 1, self.tz)
            windows_days = [(first, last)]
        else:
            if self.next15 >= req.deadline_ms:
                return self._past_deadline_series(
                    _Ledger(siblings=_ivals(req.fixed_occupied))
                )
            span = min(
                math.floor((req.deadline_ms - self.next15) / consts.DAY_MS),
                consts.MAX_SCAN_DAYS - 1,
            )
            windows = series_day_windows(span, len(members))
            start_day = local_date_str(self.next15, self.tz)
            windows_days = [
                (add_days_str(start_day, lo), add_days_str(start_day, hi))
                for lo, hi in windows
            ]

        # Single upfront batched (M, N, D) tensor build -- M=1 for a lone
        # task, no special-casing -- against an empty ledger (no member placed
        # yet), so it is a valid superset for *every* plan built from it below.
        # Each plan is then one cheap per-member loop threading its own
        # `ledger.siblings`/`count_by_day` forward; no vectors/arm-scores are
        # rebuilt per iteration or per plan.
        batch = self._build_batch(
            members, windows_days, _Ledger(siblings=_ivals(req.fixed_occupied))
        )

        primary = self._dual_plan_policy(batch)
        if primary is None:
            return self._run_plan(windows_days, batch, None)

        # Pairwise-sampled series (#58): two complete, independent plans.
        # start/outcome/appliedPolicy come from the primary plan; `heuristic`
        # is the member's pick in the heuristic plan and `linucb` its pick in
        # the LinUCB plan (null where that plan fell back / went last resort).
        heur_plan = self._run_plan(windows_days, batch, "HEURISTIC")
        lin_plan = self._run_plan(windows_days, batch, "LINUCB")
        applied = heur_plan if primary == "HEURISTIC" else lin_plan
        return [
            r.model_copy(update={"heuristic": h.heuristic, "linucb": lin.linucb})
            for r, h, lin in zip(applied, heur_plan, lin_plan, strict=True)
        ]


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
