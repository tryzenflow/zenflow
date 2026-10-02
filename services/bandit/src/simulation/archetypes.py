"""Composed student archetypes: chronotype x behavior.

The two axes are drawn independently (every cell is reachable) and each carries
seeded jitter, so two "night owl / crammer" students are similar, not equal.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from .rng import stream

CHRONOTYPES = ("early_bird", "night_owl", "midday")
BEHAVIORS = ("stable", "erratic", "crammer", "planner", "weekender")

# peak hour of the hidden time-of-day field
_PEAK = {"early_bird": 8.0, "night_owl": 21.5, "midday": 13.5}

# base parameters per behavior (jittered per student):
# noise, threshold, p_edit, inertia, drift_sd, cram, plan, weekend
_BEHAVIOR = {
    "stable": (0.05, 0.10, 0.90, 0.20, 0.00, 0.0, 0.0, 0.0),
    "erratic": (0.35, 0.08, 0.60, 0.05, 0.35, 0.0, 0.0, 0.0),
    "crammer": (0.12, 0.12, 0.80, 0.25, 0.05, 0.9, 0.0, 0.0),
    "planner": (0.08, 0.10, 0.85, 0.30, 0.00, 0.0, 0.5, 0.0),
    "weekender": (0.10, 0.10, 0.85, 0.20, 0.00, 0.0, 0.0, 0.7),
}


# night owls still have daytime obligations: (strength, obligation-day frequency,
# exam-proximity probability), each jittered per student; zero for other chronotypes
_DAYTIME_PULL = {"night_owl": (1.0, 0.30, 0.5)}


@dataclass(frozen=True)
class StudentProfile:
    student_id: int
    chronotype: str
    behavior: str
    peak_hour: float
    width: float
    weekend_shift: float  # hours the peak moves on Sat/Sun
    noise_sd: float  # perception noise on a slot's utility
    threshold: float  # min perceived gain that makes a move worth considering
    p_edit: float  # chance they actually act when a move is worth it
    inertia: float  # extra gain demanded per 4 h of dragging
    drift_sd: float  # sd (hours/day) of the peak's random walk
    cram_weight: float
    plan_weight: float
    weekend_weight: float
    # night-owl daytime pull (0 = never): how strongly a pull day lifts daytime
    # slots / damps the late-night peak, the share of days with daytime
    # obligations, and the chance a task near its deadline is an "exam" task
    daytime_strength: float = 0.0
    daytime_freq: float = 0.0
    daytime_exam_prob: float = 0.0

    @property
    def cell(self) -> str:
        return f"{self.chronotype}/{self.behavior}"


def all_cells() -> list[tuple[str, str]]:
    return [(c, b) for c in CHRONOTYPES for b in BEHAVIORS]


def draw_archetype(
    seed: int, student_id: int, balanced: bool = True
) -> tuple[str, str]:
    """Chronotype and behavior for a student.

    ``balanced`` cycles through every cell (seeded shuffle per cycle) so each
    cell gets students; otherwise each axis is an independent uniform draw.
    """
    if balanced:
        cells = all_cells()
        cycle, pos = divmod(student_id, len(cells))
        order = stream(seed, "archetype", cycle).permutation(len(cells))
        return cells[int(order[pos])]
    rng = stream(seed, "archetype", 10_000 + student_id)
    return (
        CHRONOTYPES[int(rng.integers(len(CHRONOTYPES)))],
        BEHAVIORS[int(rng.integers(len(BEHAVIORS)))],
    )


def make_student(seed: int, student_id: int, balanced: bool = True) -> StudentProfile:
    chrono, behavior = draw_archetype(seed, student_id, balanced)
    rng = stream(seed, "profile", student_id)
    noise, thr, p_edit, inertia, drift, cram, plan, wknd = _BEHAVIOR[behavior]

    def jit(v: float, rel: float = 0.25) -> float:
        return float(v * rng.uniform(1 - rel, 1 + rel))

    sp = StudentProfile(
        student_id=student_id,
        chronotype=chrono,
        behavior=behavior,
        peak_hour=_PEAK[chrono] + float(rng.uniform(-0.75, 0.75)),
        width=float(rng.uniform(2.2, 3.2)),
        weekend_shift=float(rng.uniform(0.0, 2.0)),
        noise_sd=jit(noise),
        threshold=jit(thr),
        p_edit=min(1.0, jit(p_edit, 0.1)),
        inertia=jit(inertia),
        drift_sd=jit(drift),
        cram_weight=jit(cram),
        plan_weight=jit(plan),
        weekend_weight=jit(wknd),
    )
    # drawn last (and always), so adding the pull shifts no earlier draw
    d_str, d_freq, d_exam = _DAYTIME_PULL.get(chrono, (0.0, 0.0, 0.0))
    return replace(
        sp,
        daytime_strength=jit(d_str),
        daytime_freq=min(1.0, jit(d_freq, 0.4)),
        daytime_exam_prob=min(1.0, jit(d_exam, 0.3)),
    )
