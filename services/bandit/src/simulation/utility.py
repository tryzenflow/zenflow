"""The student's hidden utility of a slot.

Deliberately neither policy's model class:

* the heuristic is a context-free weekday x hour table, but utility depends on
  the duration, the days left to the deadline and the day's fixed load, with
  product interactions between them and the time of day;
* LinUCB is linear in the d = 7 context within a time-of-day band, but utility
  is a smooth non-linear function of the time of day inside every band, with a
  sharpness that depends on the task duration.

It has a static part (the chronotype field) and context-dependent parts
(weekend shift, busy-day evening pull, crammer lateness near the due date,
planner front-loading, weekender weekend bonus) plus a slow drift of the peak.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from .archetypes import StudentProfile


def _circ(a: NDArray[np.float64], b: float) -> NDArray[np.float64]:
    """Circular distance on a 24 h clock, so a night owl's field wraps midnight."""
    d = np.abs(a - b) % 24.0
    return np.asarray(np.minimum(d, 24.0 - d), dtype=np.float64)


def _sigmoid(x: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(1.0 / (1.0 + np.exp(-x)), dtype=np.float64)


@dataclass(frozen=True)
class DayContext:
    """What the student's utility sees about a candidate day."""

    weekday: int  # ISO 1..7
    days_left: float  # whole days from this day to the deadline day
    fixed_hours: float  # lectures/exams/DND on the day
    drift_h: float  # drift of the field's peak on this day (hours)


def slot_utility(
    p: StudentProfile,
    ctx: DayContext,
    start_minute: NDArray[np.float64],
    duration_minutes: int,
) -> NDArray[np.float64]:
    """Utility of ``[start, start + duration)`` for each local start minute."""
    weekend = 1.0 if ctx.weekday >= 6 else 0.0
    h = ((start_minute + duration_minutes / 2.0) / 60.0) % 24.0
    peak = p.peak_hour + ctx.drift_h + weekend * p.weekend_shift
    z = _circ(h, peak) / p.width
    # long tasks need the right hour more: a sharper field (non-linear in duration)
    field = np.exp(-0.5 * z * z * (1.0 + duration_minutes / 240.0))
    # damp on busy days and pull toward the evening (field x load interaction)
    load = min(ctx.fixed_hours / 6.0, 1.0)
    evening = np.exp(-0.5 * (_circ(h, 20.0) / 2.0) ** 2)
    u = field * (1.0 - 0.35 * load) + 0.35 * load * evening
    # the hours opposite the peak (sleep) are bad for everyone
    u = u - 0.45 * np.exp(-0.5 * (_circ(h, peak + 12.0) / 2.0) ** 2)
    if p.weekend_weight:
        u = u * (1.0 - 0.6 * p.weekend_weight / 0.7 * (1.0 - weekend))
        u = u + p.weekend_weight * weekend
    if p.cram_weight:
        near = float(np.exp(-ctx.days_left / 3.0))
        late = _sigmoid(np.where(h < 6.0, h + 24.0, h) - 18.0)
        u = u + p.cram_weight * near * late
        u = u + 0.4 * p.cram_weight * float(np.exp(-ctx.days_left / 2.0))
    if p.plan_weight:
        u = u + p.plan_weight * min(ctx.days_left, 10.0) / 10.0
    return np.asarray(u, dtype=np.float64)
