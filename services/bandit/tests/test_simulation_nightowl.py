"""Night owls' seeded, probabilistic daytime pull."""

from __future__ import annotations

import numpy as np

from src.simulation.archetypes import StudentProfile, make_student
from src.simulation.engine import SimConfig, World
from src.simulation.utility import DayContext, slot_utility
from src.simulation.world import (
    SCENARIO_BY_NAME,
    build_calendar,
    build_daytime,
    build_drift,
    build_tasks,
    daytime_pull,
    n_calendar_days,
)

MINUTES = np.arange(0, 1440 - 60, 15, dtype=np.float64)
N_DAYS = 400


def _students(
    chrono: str, behavior: str | None = None, n: int = 12
) -> list[StudentProfile]:
    out: list[StudentProfile] = []
    i = 0
    while len(out) < n:
        p = make_student(1, i)
        if p.chronotype == chrono and (behavior is None or p.behavior == behavior):
            out.append(p)
        i += 1
    return out


def _peak_hour(p: StudentProfile, pull: float) -> float:
    u = slot_utility(p, DayContext(2, 5.0, 0.0, 0.0, pull), MINUTES, 60)
    return float(MINUTES[int(np.argmax(u))] / 60)


def test_pull_parameters_are_night_owl_only_and_jittered() -> None:
    owls = _students("night_owl", n=20)
    for p in owls:
        assert 0.7 <= p.daytime_strength <= 1.3
        assert 0.0 < p.daytime_freq < 0.6
        assert 0.0 < p.daytime_exam_prob < 0.8
    assert len({p.daytime_strength for p in owls}) > 15
    assert len({p.daytime_freq for p in owls}) > 15
    for chrono in ("early_bird", "midday"):
        for p in _students(chrono):
            assert (p.daytime_strength, p.daytime_freq) == (0.0, 0.0)
            assert daytime_pull(p, np.array([0.0, 0.0]), 0.0) == 0.0


def test_daytime_pull_happens_sometimes_but_not_always() -> None:
    for p in _students("night_owl"):
        draws = build_daytime(1, p, N_DAYS)
        pulls = np.array([daytime_pull(p, d, 0.0) for d in draws])
        assert 0.1 < (pulls > 0.5).mean() < 0.9  # some pull days, plenty without
        # a task far from its deadline feels the exam pull far less
        far = np.array([daytime_pull(p, d, 8.0) for d in draws])
        assert far.mean() < pulls.mean()


def test_night_owl_peaks_late_on_ordinary_days_and_in_daytime_on_pull_days() -> None:
    for p in _students("night_owl", "stable", 4):
        assert 19 <= _peak_hour(p, 0.0) < 24
        assert 9 <= _peak_hour(p, 1.0) < 18


def test_most_realised_days_keep_the_late_night_peak() -> None:
    for p in _students("night_owl"):
        draws = build_daytime(1, p, N_DAYS)
        peaks = np.array([_peak_hour(p, daytime_pull(p, d, 3.0)) for d in draws[:120]])
        late = ((peaks >= 19) | (peaks < 2)).mean()
        assert 0.4 < late < 1.0, f"student {p.student_id}: late-peak share {late}"


def test_pull_is_shared_luck_and_deterministic() -> None:
    p = _students("night_owl", n=1)[0]
    assert np.array_equal(build_daytime(1, p, 50), build_daytime(1, p, 50))
    assert not np.array_equal(build_daytime(1, p, 50), build_daytime(2, p, 50))
    cfg = SimConfig(seed=1, n_events=6, scenarios=("single",))
    days = n_calendar_days(6)
    args = (
        cfg,
        p,
        build_tasks(1, p.student_id, SCENARIO_BY_NAME["single"], 6),
        build_calendar(1, p.student_id, days),
        build_drift(1, p, days),
    )
    h = World(*args, "heuristic", 0.0, "single")
    ln = World(*args, "linucb", 0.15, "single")
    assert np.array_equal(h.daytime, ln.daytime)
    assert np.array_equal(h.daytime, build_daytime(1, p, len(args[4])))
