"""LinUCB warm-start prior for a cold arm (issue #60, ADR-0001 addendum).

A cold arm starts not at ``(ridge * I, 0)`` but at the ridge state plus pseudo
observations taken from the DEFAULT preference matrix: one per ``(weekday, hour)``
cell, added to the arm owning that hour, with the *typical* context of that
cell's weekday, the cell's matrix weight as the payoff and weight
``n0 / (cells owned by the arm)`` -- so every arm receives ``n0`` pseudo
observations in total. The user's learned matrix is never read. Pure: no I/O,
clock or randomness; the per-arm result is constant and cached.
"""

from __future__ import annotations

from functools import cache

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.arms import arm_of_minute
from src.core.context_vector import build_context_vector
from src.core.preference import default_preference_matrix, matrix_index
from src.models.schemas import ArmParams

# The typical candidate day of the prior: weekday = Wednesday, weekend = Saturday;
# every other context feature is identical.
TYPICAL_WEEKDAY = 3
TYPICAL_WEEKEND = 6


def typical_context(iso_weekday: int) -> NDArray[np.float64]:
    """Context of the typical candidate day for ``iso_weekday`` (1..7)."""
    return build_context_vector(
        remaining_days_until_deadline=7,
        duration_minutes=90,
        candidate_iso_weekday=TYPICAL_WEEKEND if iso_weekday >= 6 else TYPICAL_WEEKDAY,
        candidate_days_from_now=3,
        workload_by_type={"LECTURE": {"hours": 3.0}, "TASK": {"hours": 2.0}},
    )


@cache
def _prior(arm: str, ridge: float, n0: float) -> tuple[bytes, bytes]:
    matrix = default_preference_matrix()
    owned = [
        (wd, hour)
        for wd in range(1, 8)
        for hour in range(consts.PREFERENCE_SLOTS_PER_DAY)
        if arm_of_minute(hour * 60) == arm
    ]
    params = ArmParams.cold(consts.FEATURE_DIM, ridge)
    if owned and n0 > 0:
        weight = n0 / len(owned)
        for wd, hour in owned:
            params.add_observation(
                typical_context(wd), float(matrix[matrix_index(wd, hour)]), weight
            )
    return params.A.tobytes(), params.b.tobytes()


def seeded_arm_params(arm: str, ridge: float, n0: float | None = None) -> ArmParams:
    """Fresh :class:`ArmParams` for a cold ``arm`` at the warm-start prior.

    ``n0`` defaults to ``LINUCB_PRIOR_N0``; ``n0 = 0`` is exactly
    :meth:`ArmParams.cold`. The returned arrays are copies, safe to mutate.
    """
    d = consts.FEATURE_DIM
    n0 = consts.LINUCB_PRIOR_N0 if n0 is None else n0
    a, b = _prior(arm, float(ridge), float(n0))
    return ArmParams(
        np.frombuffer(a, dtype=np.float64).reshape(d, d).copy(),
        np.frombuffer(b, dtype=np.float64).copy(),
    )
