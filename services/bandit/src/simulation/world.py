"""The student's world: calendar, task stream, scenarios and drift.

Everything here is a pure function of ``(seed, student, scenario)``, so both
policy worlds of a paired run see the same calendar and the same tasks. The
calendar is UTC (24 h days), Monday 2026-01-05 is day 0.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from src.core.constants import DAY_MS, MS_PER_MINUTE

from .archetypes import StudentProfile
from .rng import stream

TZ = "UTC"
EPOCH_MS = 1_767_571_200_000  # Mon 2026-01-05T00:00Z
HOUR_MS = 60 * MS_PER_MINUTE
LOOKAHEAD_DAYS = 70  # calendar days built past the last arrival


@dataclass(frozen=True)
class Scenario:
    """A series-length / density point. ``gap_days`` is the deadline span per
    member of a series (small = dense, the sittings crowd the window)."""

    name: str
    series_len: int
    gap_days: float


SCENARIOS = (
    Scenario("single", 1, 0.0),
    Scenario("series3-loose", 3, 2.5),
    Scenario("series3-tight", 3, 1.2),
    Scenario("series6-loose", 6, 2.5),
    Scenario("series6-tight", 6, 1.2),
)
SCENARIO_BY_NAME = {s.name: s for s in SCENARIOS}


@dataclass(frozen=True)
class Task:
    task_id: int
    now_ms: int
    deadline_ms: int
    duration: int
    n_members: int


Interval = tuple[int, int]


@dataclass(frozen=True)
class Calendar:
    fixed: list[list[Interval]]  # per day index
    fixed_hours: list[float]


def day_start_ms(d: int) -> int:
    return EPOCH_MS + d * DAY_MS


def day_index(ms: int) -> int:
    return int((ms - EPOCH_MS) // DAY_MS)


def iso_weekday_of(d: int) -> int:
    return d % 7 + 1


def build_calendar(seed: int, student_id: int, n_days: int) -> Calendar:
    """Weekly lecture timetable on weekdays, an occasional DND block at weekends."""
    rng = stream(seed, "calendar", student_id)
    template: list[list[Interval]] = []
    for _ in range(5):
        blocks: list[Interval] = []
        n = int(rng.integers(1, 4))
        for _ in range(n):
            start_min = int(rng.integers(8 * 4, 17 * 4)) * 15
            dur = int(rng.choice([60, 90, 120]))
            iv = (start_min, start_min + dur)
            if all(iv[1] <= o[0] or iv[0] >= o[1] for o in blocks):
                blocks.append(iv)
        template.append(blocks)
    fixed: list[list[Interval]] = []
    hours: list[float] = []
    for d in range(n_days):
        wd = iso_weekday_of(d)
        mins: list[Interval]
        if wd <= 5:
            mins = template[wd - 1]
        elif rng.random() < 0.25:
            s = int(rng.integers(9 * 4, 13 * 4)) * 15
            mins = [(s, s + 120)]
        else:
            mins = []
        base = day_start_ms(d)
        fixed.append(
            [(base + a * MS_PER_MINUTE, base + b * MS_PER_MINUTE) for a, b in mins]
        )
        hours.append(sum(b - a for a, b in mins) / 60.0)
    return Calendar(fixed, hours)


def build_drift(seed: int, p: StudentProfile, n_days: int) -> NDArray[np.float64]:
    """Random walk (hours) of the field's peak; zero for non-drifting students."""
    rng = stream(seed, "drift", p.student_id)
    steps = rng.standard_normal(n_days) * p.drift_sd
    walk = np.cumsum(steps)
    return np.asarray(np.clip(walk, -4.0, 4.0), dtype=np.float64)


def build_daytime(seed: int, p: StudentProfile, n_days: int) -> NDArray[np.float64]:
    """Per-day uniforms ``(n_days, 2)``: obligation-day draw and exam draw.

    A pure function of ``(seed, student)``: both policy worlds read the same
    values, so the daytime pull is shared luck. Unused by non-night-owls.
    """
    rng = stream(seed, "daytime", p.student_id)
    return np.asarray(rng.random((n_days, 2)), dtype=np.float64)


def daytime_pull(
    p: StudentProfile, draws: NDArray[np.float64], days_left: float
) -> float:
    """Pull toward daytime (0..1) of a candidate day for a task ``days_left`` from
    its deadline: full on an obligation day (probability ``daytime_freq``),
    otherwise an exam-style pull that grows toward the deadline for the
    ``daytime_exam_prob`` share of days."""
    if not p.daytime_strength:
        return 0.0
    if draws[0] < p.daytime_freq:
        return 1.0
    if draws[1] < p.daytime_exam_prob:
        return float(math.exp(-days_left / 2.0))
    return 0.0


def build_tasks(
    seed: int, student_id: int, scenario: Scenario, n_events: int
) -> list[Task]:
    """One arrival event per day: a lone task or a multi-sitting series."""
    rng = stream(seed, "tasks", student_id)
    tasks: list[Task] = []
    for i in range(n_events):
        arrival_min = int(rng.integers(7 * 4, 21 * 4)) * 15
        duration = int(rng.choice([30, 60, 90, 120], p=[0.2, 0.4, 0.25, 0.15]))
        dl_hour = int(rng.integers(12, 23))
        single_span = int(rng.integers(1, 8))
        n = scenario.series_len
        span = single_span if n == 1 else math.ceil(n * scenario.gap_days)
        tasks.append(
            Task(
                task_id=i,
                now_ms=day_start_ms(i) + arrival_min * MS_PER_MINUTE,
                deadline_ms=day_start_ms(i + span) + dl_hour * HOUR_MS,
                duration=duration,
                n_members=n,
            )
        )
    return tasks


def n_calendar_days(n_events: int) -> int:
    return n_events + LOOKAHEAD_DAYS
