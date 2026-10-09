"""Paired closed-loop runs: the same student, calendar and tasks under each policy.

Each *world* places every task with one policy, lets the student react (keep or
drag), applies the production learning rules and moves on. Per placement it
records the regret against an oracle (the best free slot in the same window by
the student's true utility), acceptance and drag distance.

The slot selection calls the real ``src.core`` functions (``best_free_slot``,
``best_linucb_slot``, ``build_context_vector``, ``series_day_windows``); the
glue around them mirrors ``src.policies`` / ``src.place`` minus the pydantic
layer (a parity test pins it to ``/v1/place``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.arms import seeded_tie_break_order
from src.core.context_vector import build_context_vector
from src.core.linucb_best_slot import LinucbCandidateDay, best_linucb_slot
from src.core.reward import drag_distance_reward
from src.core.series_spread import series_day_windows
from src.core.slot import ceil_to_slot
from src.core.slot_score import (
    best_free_slot,
    free_start_mask,
    slot_preference_score,
)

from .archetypes import StudentProfile, make_student
from .learner import RETAINED_REWARD, LinUCBState, PreferenceMatrix
from .reaction import decide, draw_reaction
from .utility import DayContext, slot_utility
from .world import (
    SCENARIO_BY_NAME,
    SCENARIOS,
    TZ,
    Calendar,
    Interval,
    Task,
    build_calendar,
    build_daytime,
    build_drift,
    build_tasks,
    day_index,
    day_start_ms,
    daytime_pull,
    iso_weekday_of,
    n_calendar_days,
)

HEURISTIC = "heuristic"
SINGLE_SCAN_DAYS = consts.SCAN_CAP_DAYS
SERIES_SCAN_DAYS = consts.MAX_SCAN_DAYS


@dataclass(frozen=True)
class SimConfig:
    seed: int = 1
    n_students: int = 75
    n_events: int = 60
    alphas: tuple[float, ...] = (0.15,)
    ridge: float = 1.0
    scenarios: tuple[str, ...] = tuple(s.name for s in SCENARIOS)
    balanced: bool = True
    # weight of the preference matrix in the LinUCB slot score (0 = pure arm band)
    pref_weight: float = consts.LINUCB_PREF_WEIGHT


def linucb_label(alpha: float) -> str:
    return f"linucb@{alpha:g}"


@dataclass
class PlacementLog:
    """Per-placement records of one world (columns, appended in order)."""

    task_id: list[int] = field(default_factory=list)
    member: list[int] = field(default_factory=list)
    obs_before: list[int] = field(default_factory=list)
    regret: list[float] = field(default_factory=list)
    accepted: list[float] = field(default_factory=list)
    drag: list[float] = field(default_factory=list)
    start: list[int] = field(default_factory=list)
    used_linucb: list[float] = field(default_factory=list)
    infeasible: int = 0

    def arrays(self) -> dict[str, NDArray[np.float64]]:
        return {
            "task_id": np.asarray(self.task_id, dtype=np.float64),
            "member": np.asarray(self.member, dtype=np.float64),
            "obs_before": np.asarray(self.obs_before, dtype=np.float64),
            "regret": np.asarray(self.regret, dtype=np.float64),
            "accepted": np.asarray(self.accepted, dtype=np.float64),
            "drag": np.asarray(self.drag, dtype=np.float64),
            "start": np.asarray(self.start, dtype=np.float64),
            "used_linucb": np.asarray(self.used_linucb, dtype=np.float64),
        }


@dataclass
class _Day:
    idx: int
    start_ms: int
    end_ms: int
    occupied: list[Interval]
    fixed_hours: float
    flex_hours: float


@dataclass
class _Proposal:
    start_ms: int
    duration: int
    day_idx: int
    day_ctx: DayContext
    arm: str | None  # set only when LinUCB made the pick
    x: NDArray[np.float64] | None
    regret: float
    utility: float
    cand_days: list[_Day]


class World:
    def __init__(
        self,
        cfg: SimConfig,
        profile: StudentProfile,
        tasks: list[Task],
        calendar: Calendar,
        drift: NDArray[np.float64],
        policy: str,
        alpha: float,
        scenario: str,
        daytime: NDArray[np.float64] | None = None,
    ) -> None:
        self.cfg = cfg
        self.daytime = (
            build_daytime(cfg.seed, profile, len(drift)) if daytime is None else daytime
        )
        self.p = profile
        self.tasks = tasks
        self.cal = calendar
        self.drift = drift
        self.policy = policy
        self.scenario = scenario
        self.prefs = PreferenceMatrix(TZ)
        self.linucb = LinUCBState(alpha, cfg.ridge) if policy != HEURISTIC else None
        self.placed: list[Interval] = []
        self.log = PlacementLog()
        self._last_day = 0

    # ---- calendar views -------------------------------------------------
    def _flex_hours(self) -> dict[int, float]:
        out: dict[int, float] = {}
        for s, e in self.placed:
            d = day_index(s)
            out[d] = out.get(d, 0.0) + (e - s) / consts.HOUR_MS
        return out

    def _day(self, idx: int, flex: dict[int, float]) -> _Day:
        start = day_start_ms(idx)
        end = start + consts.DAY_MS
        occ = list(self.cal.fixed[idx])
        occ.extend((s, e) for s, e in self.placed if e > start and s < end)
        return _Day(idx, start, end, occ, self.cal.fixed_hours[idx], flex.get(idx, 0.0))

    def _ctx(self, day: _Day, deadline_day: int) -> DayContext:
        days_left = float(max(0, deadline_day - day.idx))
        return DayContext(
            weekday=iso_weekday_of(day.idx),
            days_left=days_left,
            fixed_hours=day.fixed_hours,
            drift_h=float(self.drift[day.idx]),
            daytime_pull=daytime_pull(self.p, self.daytime[day.idx], days_left),
        )

    # ---- slot machinery ---------------------------------------------------
    @staticmethod
    def _free_starts(
        day: _Day, duration: int, next_ms: int, deadline_ms: int, extra: list[Interval]
    ) -> NDArray[np.int64]:
        dur_ms = duration * consts.MS_PER_MINUTE
        lower = max(ceil_to_slot(day.start_ms), next_ms)
        upper = min(day.end_ms + dur_ms - consts.SLOT_MS, deadline_ms)
        if lower + dur_ms > upper:
            return np.empty(0, dtype=np.int64)
        n = (upper - dur_ms - lower) // consts.SLOT_MS + 1
        mask = free_start_mask(lower, n, dur_ms, [*day.occupied, *extra])
        return np.asarray(
            lower + np.arange(n, dtype=np.int64)[mask] * consts.SLOT_MS, dtype=np.int64
        )

    def _utility(
        self, day: _Day, ctx: DayContext, starts: NDArray[np.int64], duration: int
    ) -> NDArray[np.float64]:
        minute = (starts - day.start_ms) / consts.MS_PER_MINUTE
        return slot_utility(self.p, ctx, np.asarray(minute, dtype=np.float64), duration)

    # ---- placement ---------------------------------------------------------
    def _heuristic_pick(
        self,
        days: list[_Day],
        duration: int,
        next_ms: int,
        now_ms: int,
        deadline_ms: int,
        extra: list[Interval],
    ) -> int | None:
        # mirrors HeuristicPolicy.best_slot: best slot per day, best score wins
        dur_ms = duration * consts.MS_PER_MINUTE
        overhang = dur_ms - consts.SLOT_MS
        best: tuple[float, int] | None = None
        for d in days:
            slot = best_free_slot(
                duration,
                [*d.occupied, *extra],
                max(now_ms, d.start_ms),
                min(deadline_ms, d.end_ms),
                self.prefs.matrix,
                TZ,
                min(deadline_ms, d.end_ms + overhang),
                None,
            )
            if slot is None:
                continue
            score = slot_preference_score(self.prefs.matrix, slot, slot + dur_ms, TZ)
            if best is None or score > best[0]:
                best = (score, slot)
        return None if best is None else best[1]

    def _linucb_pick(
        self,
        days: list[_Day],
        ctxs: list[DayContext],
        task: Task,
        next_ms: int,
        extra: list[Interval],
        tie_seed: str,
        flex_days: list[float],
    ) -> tuple[int, str, NDArray[np.float64]] | None:
        assert self.linucb is not None
        remaining = max(0, math.floor((task.deadline_ms - task.now_ms) / consts.DAY_MS))
        today = day_index(task.now_ms)
        xs = np.stack(
            [
                build_context_vector(
                    remaining_days_until_deadline=remaining,
                    duration_minutes=task.duration,
                    candidate_iso_weekday=c.weekday,
                    candidate_days_from_now=max(0, d.idx - today),
                    workload_by_type={
                        "LECTURE": {"hours": d.fixed_hours},
                        "TASK": {"hours": fl},
                    },
                )
                for d, c, fl in zip(days, ctxs, flex_days, strict=True)
            ]
        )
        scores = self.linucb.arm_scores(xs)
        cand = [
            LinucbCandidateDay(
                day_str=str(d.idx),
                day_start_ms=d.start_ms,
                day_end_ms=d.end_ms,
                occupied=d.occupied,
                vector=xs[i].tolist(),
                arm_scores={a: float(v[i]) for a, v in scores.items()},
            )
            for i, d in enumerate(days)
        ]
        best = best_linucb_slot(
            cand,
            task.duration,
            TZ,
            next_ms,
            task.deadline_ms,
            extra,
            None,
            seeded_tie_break_order(tie_seed),
            self.prefs.matrix,
            self.cfg.pref_weight,
        )
        if best is None or not math.isfinite(best.score):
            return None
        return best.start_ms, best.arm, np.asarray(best.vector, dtype=np.float64)

    def _windows(self, task: Task, next_ms: int) -> list[tuple[int, int]]:
        first = day_index(next_ms)
        if task.n_members == 1:
            return [(first, day_index(task.deadline_ms - 1))]
        span = min(
            math.floor((task.deadline_ms - next_ms) / consts.DAY_MS),
            consts.MAX_SCAN_DAYS - 1,
        )
        return [
            (first + lo, first + hi)
            for lo, hi in series_day_windows(span, task.n_members)
        ]

    def _propose(
        self,
        task: Task,
        window: tuple[int, int],
        siblings: list[Interval],
        sibling_days: set[int],
        flex: dict[int, float],
        tie_seed: str,
    ) -> _Proposal | None:
        next_ms = ceil_to_slot(task.now_ms)
        cap = SINGLE_SCAN_DAYS if task.n_members == 1 else SERIES_SCAN_DAYS
        idxs = [
            d
            for d in range(window[0], window[1] + 1)
            if d not in sibling_days and d < len(self.cal.fixed)
        ][:cap]
        days = [self._day(i, flex) for i in idxs]
        dl_day = day_index(task.deadline_ms - 1)
        ctxs = [self._ctx(d, dl_day) for d in days]

        # oracle: best free slot in the window by the student's true utility
        best_u = -math.inf
        for d, c in zip(days, ctxs, strict=True):
            starts = self._free_starts(
                d, task.duration, next_ms, task.deadline_ms, siblings
            )
            if starts.size:
                best_u = max(
                    best_u, float(self._utility(d, c, starts, task.duration).max())
                )
        if best_u == -math.inf:
            return None

        start: int | None = None
        arm: str | None = None
        x: NDArray[np.float64] | None = None
        if self.linucb is not None:
            pick = self._linucb_pick(
                days,
                ctxs,
                task,
                next_ms,
                siblings,
                tie_seed,
                [d.flex_hours for d in days],
            )
            if pick is not None:
                start, arm, x = pick
        if start is None:
            start = self._heuristic_pick(
                days, task.duration, next_ms, task.now_ms, task.deadline_ms, siblings
            )
        if start is None:
            return None
        di = next(i for i, d in enumerate(days) if d.start_ms <= start < d.end_ms)
        u = float(
            self._utility(
                days[di], ctxs[di], np.array([start], dtype=np.int64), task.duration
            )[0]
        )
        return _Proposal(
            start,
            task.duration,
            days[di].idx,
            ctxs[di],
            arm,
            x,
            max(0.0, best_u - u),
            u,
            days,
        )

    # ---- one arrival event --------------------------------------------------
    def _tie_seed(self, task: Task, member: int) -> str:
        """Seed of the cold-start band order (the service uses ``requestId|id``)."""
        return (
            f"{self.cfg.seed}|{self.p.student_id}|{self.scenario}"
            f"|{task.task_id}|{member}"
        )

    def _propose_all(
        self, task: Task, flex: dict[int, float]
    ) -> list[_Proposal | None]:
        """Place every member (series: per-member window, one sitting per day)."""
        next_ms = ceil_to_slot(task.now_ms)
        siblings: list[Interval] = []
        sibling_days: set[int] = set()
        props: list[_Proposal | None] = []
        for m, win in enumerate(self._windows(task, next_ms)):
            tie = self._tie_seed(task, m)
            prop = self._propose(task, win, siblings, sibling_days, flex, tie)
            props.append(prop)
            if prop is not None:
                dur_ms = task.duration * consts.MS_PER_MINUTE
                siblings.append((prop.start_ms, prop.start_ms + dur_ms))
                sibling_days.add(day_index(prop.start_ms))
        return props

    def _event(self, task: Task) -> None:
        today = day_index(task.now_ms)
        if today > self._last_day:
            self.prefs.decay(today - self._last_day)  # nightly decay
            self._last_day = today
        self.placed = [
            (s, e) for s, e in self.placed if e > day_start_ms(today) - consts.DAY_MS
        ]
        props = self._propose_all(task, self._flex_hours())
        dur_ms = task.duration * consts.MS_PER_MINUTE
        current: list[Interval] = [
            (0, 0) if p is None else (p.start_ms, p.start_ms + dur_ms) for p in props
        ]
        for m, prop in enumerate(props):
            if prop is None:
                self.log.infeasible += 1
                continue
            others = [iv for j, iv in enumerate(current) if j != m and iv[1] > iv[0]]
            self._react(task, m, prop, others, current)

    def _react(
        self,
        task: Task,
        m: int,
        prop: _Proposal,
        others: list[Interval],
        current: list[Interval],
    ) -> None:
        day = next(d for d in prop.cand_days if d.idx == prop.day_idx)
        next_ms = ceil_to_slot(task.now_ms)
        starts = self._free_starts(
            day, task.duration, next_ms, task.deadline_ms, others
        )
        utils = self._utility(day, prop.day_ctx, starts, task.duration)
        draws = draw_reaction(self.cfg.seed, self.p.student_id, task.task_id, m)
        target = decide(self.p, draws, prop.start_ms, prop.utility, starts, utils)

        dur_ms = task.duration * consts.MS_PER_MINUTE
        if target is None:
            final = prop.start_ms
            drag = 0.0
            self.prefs.retained(final)
            if self.linucb is not None and prop.arm is not None and prop.x is not None:
                self.linucb.observe(prop.arm, prop.x, RETAINED_REWARD)
        else:
            final = target
            drag = (target - prop.start_ms) / consts.MS_PER_MINUTE
            self.prefs.moved(prop.start_ms, target, drag)
            if self.linucb is not None and prop.arm is not None and prop.x is not None:
                self.linucb.observe(prop.arm, prop.x, drag_distance_reward(drag))
        current[m] = (final, final + dur_ms)
        self.placed.append((final, final + dur_ms))

        log = self.log
        log.obs_before.append(len(log.task_id))
        log.task_id.append(task.task_id)
        log.member.append(m)
        log.regret.append(prop.regret)
        log.accepted.append(1.0 if target is None else 0.0)
        log.drag.append(abs(drag))
        log.start.append(prop.start_ms)
        log.used_linucb.append(1.0 if prop.arm is not None else 0.0)

    def run(self) -> PlacementLog:
        for task in self.tasks:
            self._event(task)
        return self.log


@dataclass
class StudentResult:
    student_id: int
    chronotype: str
    behavior: str
    logs: dict[str, dict[str, dict[str, NDArray[np.float64]]]]
    # logs[scenario][policy label] -> columns


def run_student(cfg: SimConfig, student_id: int) -> StudentResult:
    """Every scenario x policy world of one student (heuristic once, LinUCB/alpha)."""
    profile = make_student(cfg.seed, student_id, cfg.balanced)
    n_days = n_calendar_days(cfg.n_events)
    calendar = build_calendar(cfg.seed, student_id, n_days)
    drift = build_drift(cfg.seed, profile, n_days)
    daytime = build_daytime(cfg.seed, profile, n_days)
    out: dict[str, dict[str, dict[str, NDArray[np.float64]]]] = {}
    for name in cfg.scenarios:
        tasks = build_tasks(cfg.seed, student_id, SCENARIO_BY_NAME[name], cfg.n_events)
        worlds: dict[str, dict[str, NDArray[np.float64]]] = {}
        h = World(cfg, profile, tasks, calendar, drift, HEURISTIC, 0.0, name, daytime)
        worlds[HEURISTIC] = h.run().arrays()
        for alpha in cfg.alphas:
            lw = World(
                cfg, profile, tasks, calendar, drift, "linucb", alpha, name, daytime
            )
            worlds[linucb_label(alpha)] = lw.run().arrays()
        out[name] = worlds
    return StudentResult(student_id, profile.chronotype, profile.behavior, out)
