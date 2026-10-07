"""Per-policy learned state, updated with the production rules.

* Preference matrix (shared rule, eta = 0.1, nightly decay): MOVE lowers the old
  hour and raises the new one by ``eta * g`` (``g = |drag_distance_reward|``);
  RETAINED raises the kept hour by ``eta * 0.25``. The helpers are the real
  ``src.core.preference`` functions.
* LinUCB ``(A, b)`` per arm: MOVE reward = ``drag_distance_reward``, RETAINED =
  +1, via ``src.models.linucb.update`` / ``score``. Only sessions that actually
  carried a LinUCB proposal update it.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from src.core.arms import ARM_BANDS
from src.core.constants import FEATURE_DIM, PREFERENCE_RETAINED_WEIGHT
from src.core.preference import (
    decay_matrix,
    default_preference_matrix,
    reinforce_preference_cell,
    reinforce_preference_move,
)
from src.models.linucb import score as linucb_score
from src.models.linucb import update as linucb_update

from .prior import PriorSpec, warm_state

ARMS = tuple(b[0] for b in ARM_BANDS)
RETAINED_REWARD = 1.0


class PreferenceMatrix:
    def __init__(self, timezone: str) -> None:
        self.tz = timezone
        self.matrix: NDArray[np.float64] = default_preference_matrix()

    def decay(self, delta_days: float) -> None:
        self.matrix = decay_matrix(self.matrix, delta_days)

    def retained(self, start_ms: int) -> None:
        self.matrix = reinforce_preference_cell(
            self.matrix, start_ms, self.tz, PREFERENCE_RETAINED_WEIGHT
        )

    def moved(self, old_ms: int, new_ms: int, drag_minutes: float) -> None:
        self.matrix = reinforce_preference_move(
            self.matrix, old_ms, new_ms, self.tz, drag_minutes
        )


class LinUCBState:
    def __init__(
        self, alpha: float, ridge: float, prior: PriorSpec | None = None
    ) -> None:
        self.alpha = alpha
        if prior is not None and prior.active:
            self.a, self.b = warm_state(prior, ridge)
        else:
            self.a = {arm: ridge * np.identity(FEATURE_DIM) for arm in ARMS}
            self.b = {arm: np.zeros(FEATURE_DIM) for arm in ARMS}

    def arm_scores(self, x: NDArray[np.float64]) -> dict[str, NDArray[np.float64]]:
        """Score every arm for a batch ``(n, d)`` of per-day context vectors."""
        return {
            arm: np.asarray(
                linucb_score(self.a[arm], self.b[arm], x, self.alpha),
                dtype=np.float64,
            )
            for arm in ARMS
        }

    def observe(self, arm: str, x: NDArray[np.float64], reward: float) -> None:
        self.a[arm], self.b[arm] = linucb_update(self.a[arm], self.b[arm], x, reward)
